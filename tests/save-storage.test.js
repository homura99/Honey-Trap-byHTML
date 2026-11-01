import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import { loadGameData } from "../src/data/validate.js";
import { GameEngine } from "../src/game/engine.js";
import {
  createAutoSaveHandler,
  IndexedDBSaveRepository,
  SAVE_SLOTS,
} from "../src/storage/indexeddb-save-repository.js";

async function loadGameDataFixture() {
  const root = new URL("../data/", import.meta.url);
  const scenarioDirectory = new URL("../data/endings/scenarios/", import.meta.url);
  const endingScenarios = {};
  const scenarioNames = await readdir(scenarioDirectory);

  for (const name of scenarioNames.filter((entry) => entry.endsWith(".yaml"))) {
    endingScenarios[`scenarios/${name}`] = await readFile(new URL(name, scenarioDirectory), "utf8");
  }

  const result = loadGameData({
    "data/stages.yaml": await readFile(new URL("stages.yaml", root), "utf8"),
    "data/settings.yaml": await readFile(new URL("settings.yaml", root), "utf8"),
    "data/actions.yaml": await readFile(new URL("actions.yaml", root), "utf8"),
    "data/events.yaml": await readFile(new URL("events.yaml", root), "utf8"),
    "data/endings/index.yaml": await readFile(new URL("endings/index.yaml", root), "utf8"),
    endingScenarios,
  });
  assert.deepEqual(result.errors, []);
  return result.data;
}

async function createHarness(options = {}) {
  const gameData = await loadGameDataFixture();
  const databaseName = `save-tests-${Math.random().toString(36).slice(2)}`;
  const repository = new IndexedDBSaveRepository(gameData, {
    indexedDB: options.indexedDB ?? indexedDB,
    databaseName,
    profileId: options.profileId ?? "test-profile",
  });
  const engine = new GameEngine(gameData, options.difficultyId ?? "sweet");
  return { databaseName, engine, gameData, repository };
}

async function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRecord(databaseName, storeName, key) {
  const database = await openDatabase(databaseName);
  try {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function updateRecord(databaseName, storeName, key, update) {
  const database = await openDatabase(databaseName);
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => {
        const record = request.result;
        update(record);
        store.put(record);
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

test("saves to a new manual slot, overwrites it, and identifies all empty slots", async (t) => {
  const { engine, repository } = await createHarness();
  t.after(() => repository.close());

  const initialSlots = await repository.listSlots();
  assert.equal(initialSlots.length, 6);
  assert.ok(initialSlots.every((slot) => !slot.occupied && slot.savedAt === null));

  const firstSave = await repository.saveManual(engine, "manual-1");
  assert.equal(firstSave.occupied, true);
  engine.state.affection = 35;
  const overwritten = await repository.saveManual(engine, "manual-1");

  assert.notEqual(overwritten.savedAt, firstSave.savedAt);
  const loadedEngine = new GameEngine(engine.gameData, "spicy");
  await repository.load(loadedEngine, "manual-1");
  assert.equal(loadedEngine.state.affection, 35);
  assert.equal(loadedEngine.state.difficultyId, "sweet");
});

test("returns null for an empty slot and rejects unsafe manual save timing", async (t) => {
  const { engine, repository } = await createHarness();
  t.after(() => repository.close());

  assert.equal(await repository.load(engine, "manual-2"), null);
  engine.state.activeEventId = "sample-arrival";
  assert.equal(engine.canSave, false);
  await assert.rejects(repository.saveManual(engine, "manual-2"), /safe game state/);
  engine.state.activeEventId = null;
  engine.state.stageTransitionPending = true;
  assert.equal(engine.canSave, false);
});

test("restores negative stamina, event history, cooldowns, and pending events", async (t) => {
  const { engine, repository } = await createHarness();
  t.after(() => repository.close());

  engine.state.stamina = -42.5;
  engine.state.eventHistory.push(
    { eventId: "sample-follow-up", status: "completed", stageNumber: 1 },
    { eventId: "sample-arrival", status: "deferred", stageNumber: 1 },
  );
  engine.state.eventCooldowns["sample-follow-up"] = 1;
  engine.state.pendingEvents.push({ eventId: "sample-arrival", deferredAtStage: 1 });
  engine.state.choiceHistory.push({ eventId: "sample-arrival", choiceId: "continue" });
  engine.state.storyFlags.sample_event_seen = true;
  await repository.saveManual(engine, "manual-3");

  const loaded = new GameEngine(engine.gameData, "spicy");
  await repository.load(loaded, "manual-3");

  assert.equal(loaded.state.stamina, -42.5);
  assert.deepEqual(loaded.state.eventHistory, engine.state.eventHistory);
  assert.deepEqual(loaded.state.eventCooldowns, engine.state.eventCooldowns);
  assert.deepEqual(loaded.state.pendingEvents, engine.state.pendingEvents);
  assert.deepEqual(loaded.state.choiceHistory, engine.state.choiceHistory);
  assert.deepEqual(loaded.state.storyFlags, engine.state.storyFlags);
});

test("auto-saves after actions and confirmed stage transitions", async (t) => {
  const { gameData, repository } = await createHarness();
  t.after(() => repository.close());
  const engine = new GameEngine(gameData, "sweet", {
    autoSave: createAutoSaveHandler(repository),
  });

  const actionResult = await engine.performAction("conversation");
  assert.equal(actionResult.autoSave.success, true);
  const savedAfterAction = await repository.listSlots();
  assert.equal(savedAfterAction.find((slot) => slot.slotId === SAVE_SLOTS.auto).progress.affection, 12);

  const stage = gameData["data/stages.yaml"].stages[0];
  const end = Date.parse(`${stage.endDate}T23:59:00Z`) / 60000;
  engine.state.currentTimeMinutes = end - 30;
  await engine.performAction("conversation");
  const transition = await engine.confirmStageTransition();

  assert.equal(transition.stageId, "stage-02");
  assert.equal(transition.autoSave.success, true);
  const savedAfterTransition = await repository.listSlots();
  assert.equal(
    savedAfterTransition.find((slot) => slot.slotId === SAVE_SLOTS.auto).progress.currentStageId,
    "stage-02",
  );
});

test("reports auto-save failures without reverting game progress", async () => {
  const { engine } = await createHarness();
  engine.setAutoSaveHandler(async () => {
    throw new Error("quota exceeded");
  });

  const result = await engine.performAction("conversation");

  assert.equal(engine.state.affection, 12);
  assert.equal(result.autoSave.success, false);
  assert.match(result.autoSave.error, /quota exceeded/);
});

test("shares ending collection across slots and calculates completion rate", async (t) => {
  const { databaseName, gameData, repository } = await createHarness();
  const otherRepository = new IndexedDBSaveRepository(gameData, {
    indexedDB,
    databaseName,
    profileId: "test-profile",
  });
  t.after(async () => {
    await Promise.all([repository.close(), otherRepository.close()]);
  });

  await repository.addCollectedEnding("abandonment");
  await repository.saveManual(new GameEngine(gameData, "sweet"), "manual-1");
  await repository.saveAuto(new GameEngine(gameData, "spicy"));

  assert.deepEqual((await otherRepository.getEndingCollection()).endingIds, ["abandonment"]);
  assert.deepEqual(await otherRepository.getEndingCompletionRate(), {
    collected: 1,
    total: 2,
    rate: 0.5,
  });
  assert.deepEqual(await repository.addCollectedEnding("abandonment"), ["abandonment"]);
});

test("exports a saved slot as versioned JSON without adding an import operation", async (t) => {
  const { engine, repository } = await createHarness();
  t.after(() => repository.close());

  await repository.saveManual(engine, "manual-4");
  const exported = JSON.parse(await repository.exportSlotJson("manual-4"));

  assert.equal(exported.exportFormat, "honey-trap-save");
  assert.equal(exported.formatVersion, 1);
  assert.equal(exported.slot.slotId, "manual-4");
  assert.equal(exported.slot.gameState.schemaVersion, 1);
  assert.equal(typeof exported.exportedAt, "string");
});

test("detects corrupt saves and refuses to load or overwrite them", async (t) => {
  const { databaseName, engine, repository } = await createHarness();
  t.after(() => repository.close());

  await repository.saveManual(engine, "manual-5");
  const key = "test-profile::manual-5";
  await updateRecord(databaseName, "slots", key, (record) => {
    record.gameState.affection = 101;
  });

  const slots = await repository.listSlots();
  assert.equal(slots.find((slot) => slot.slotId === "manual-5").corrupted, true);
  const untouched = new GameEngine(engine.gameData, "spicy");
  const initialDifficulty = untouched.state.difficultyId;
  await assert.rejects(repository.load(untouched, "manual-5"), /Affection is outside/);
  assert.equal(untouched.state.difficultyId, initialDifficulty);
  await assert.rejects(repository.saveManual(engine, "manual-5"), /Affection is outside/);
  const corruptRecord = await readRecord(databaseName, "slots", key);
  assert.equal(corruptRecord.gameState.affection, 101);

  await updateRecord(databaseName, "slots", key, (record) => {
    record.gameState.affection = 10;
    record.gameState.currentStageId = "missing-stage";
  });
  await assert.rejects(repository.load(untouched, "manual-5"), /Current stage ID and index/);
  assert.equal(untouched.state.difficultyId, initialDifficulty);
});

test("rejects incompatible save versions without replacing stored data", async (t) => {
  const { databaseName, engine, repository } = await createHarness();
  t.after(() => repository.close());
  await repository.saveManual(engine, "manual-1");
  const key = "test-profile::manual-1";
  await updateRecord(databaseName, "slots", key, (record) => {
    record.formatVersion = 999;
  });

  await assert.rejects(repository.load(engine, "manual-1"), /Unsupported save format version/);
  await assert.rejects(repository.saveManual(engine, "manual-1"), /Unsupported save format version/);
  assert.equal((await readRecord(databaseName, "slots", key)).formatVersion, 999);

  assert.throws(
    () => engine.restoreState({ ...engine.createSaveSnapshot(), schemaVersion: 999 }),
    /Unsupported game state version/,
  );
});

test("reports IndexedDB write failures to manual and auto-save callers", async (t) => {
  const databaseName = `write-failure-${Math.random().toString(36).slice(2)}`;
  const failingIndexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          transaction() {
            throw new Error("Injected IndexedDB write failure.");
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  const { engine, gameData } = await createHarness();
  const failingRepository = new IndexedDBSaveRepository(gameData, {
    indexedDB: failingIndexedDB,
    databaseName,
    profileId: "test-profile",
  });
  t.after(() => failingRepository.close());

  await assert.rejects(
    failingRepository.saveManual(engine, "manual-1"),
    /Injected IndexedDB write failure/,
  );
  engine.setAutoSaveHandler(createAutoSaveHandler(failingRepository));
  const result = await engine.performAction("conversation");
  assert.equal(result.autoSave.success, false);
  assert.match(result.autoSave.error, /Injected IndexedDB write failure/);
  assert.equal(engine.state.affection, 12);
});
