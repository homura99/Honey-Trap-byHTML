import {
  doc,
  getDoc,
  runTransaction,
} from "firebase/firestore";
import { validateGameSnapshot } from "../game/save-state.js";
import { parseSaveExport } from "./save-export.js";
import { SAVE_SLOTS } from "./indexeddb-save-repository.js";

const SAVE_FORMAT_VERSION = 1;
const ALL_SLOT_IDS = [...SAVE_SLOTS.manual, SAVE_SLOTS.auto];

function progressFor(gameData, snapshot) {
  const stage = gameData["data/stages.yaml"].stages[snapshot.currentStageIndex];
  return {
    currentStageId: snapshot.currentStageId,
    currentStageNumber: stage.number,
    affection: snapshot.affection,
    stamina: snapshot.stamina,
    subscribers: snapshot.subscribers,
    endingId: snapshot.endingId,
  };
}

function validateSlotRecord(gameData, record, userId, slotId) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
    record.formatVersion !== SAVE_FORMAT_VERSION || record.profileId !== userId ||
    record.key !== `${userId}::${slotId}` || record.slotId !== slotId ||
    typeof record.savedAt !== "string" || Number.isNaN(Date.parse(record.savedAt))) {
    throw new Error("クラウドセーブの形式または所有者情報が不正です。");
  }

  const validation = validateGameSnapshot(gameData, record.gameState);
  if (!validation.valid) {
    throw new Error(`クラウドセーブが破損しています:\n${validation.errors.join("\n")}`);
  }
  const expectedProgress = progressFor(gameData, record.gameState);
  if (!record.progress || Object.keys(expectedProgress).some(
    (key) => record.progress[key] !== expectedProgress[key],
  )) {
    throw new Error("クラウドセーブの進行状況がゲームデータと一致しません。");
  }
  return record;
}

function validateEndingRecord(record, userId, knownEndingIds) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
    record.profileId !== userId || record.formatVersion !== SAVE_FORMAT_VERSION ||
    !Array.isArray(record.endingIds) ||
    record.endingIds.some((endingId) => !knownEndingIds.has(endingId)) ||
    new Set(record.endingIds).size !== record.endingIds.length ||
    typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt))) {
    throw new Error("クラウドのエンディング記録が破損しています。");
  }
  return record;
}

export class FirestoreSaveRepository {
  constructor(gameData, auth, database) {
    this.gameData = gameData;
    this.auth = auth;
    this.database = database;
  }

  #userId() {
    const userId = this.auth.currentUser?.uid;
    if (!userId) {
      throw new Error("クラウドセーブにはログインが必要です。");
    }
    return userId;
  }

  #slotReference(userId, slotId) {
    return doc(this.database, "users", userId, "slots", slotId);
  }

  #createSlotRecord(userId, slotId, snapshot, savedAt = new Date().toISOString()) {
    if (!ALL_SLOT_IDS.includes(slotId)) {
      throw new RangeError(`Unknown save slot "${String(slotId)}".`);
    }
    const validation = validateGameSnapshot(this.gameData, snapshot);
    if (!validation.valid) {
      throw new Error(`Cannot save invalid game state:\n${validation.errors.join("\n")}`);
    }
    return {
      key: `${userId}::${slotId}`,
      profileId: userId,
      slotId,
      formatVersion: SAVE_FORMAT_VERSION,
      savedAt,
      progress: progressFor(this.gameData, snapshot),
      gameState: structuredClone(snapshot),
    };
  }

  #slotSummary(record) {
    return {
      slotId: record.slotId,
      type: record.slotId === SAVE_SLOTS.auto ? "auto" : "manual",
      occupied: true,
      savedAt: record.savedAt,
      progress: structuredClone(record.progress),
    };
  }

  async #writeSlot(record) {
    const reference = this.#slotReference(record.profileId, record.slotId);
    await runTransaction(this.database, async (transaction) => {
      const existing = await transaction.get(reference);
      if (existing.exists()) {
        const existingRecord = validateSlotRecord(
          this.gameData,
          existing.data(),
          record.profileId,
          record.slotId,
        );
        const previousTimestamp = Date.parse(existingRecord.savedAt);
        if (Date.parse(record.savedAt) <= previousTimestamp) {
          record.savedAt = new Date(previousTimestamp + 1).toISOString();
        }
      }
      transaction.set(reference, record);
    });
    return this.#slotSummary(record);
  }

  async saveManual(engine, slotId) {
    if (!SAVE_SLOTS.manual.includes(slotId)) {
      throw new RangeError(`Unknown manual save slot "${String(slotId)}".`);
    }
    if (!engine.canSave) {
      throw new Error("Manual saving is only allowed at a safe game state.");
    }
    const record = this.#createSlotRecord(
      this.#userId(),
      slotId,
      engine.createSaveSnapshot(),
    );
    return this.#writeSlot(record);
  }

  async saveAutoSnapshot(snapshot) {
    const record = this.#createSlotRecord(this.#userId(), SAVE_SLOTS.auto, snapshot);
    return this.#writeSlot(record);
  }

  async saveAuto(engine) {
    return this.saveAutoSnapshot(engine.createSaveSnapshot());
  }

  async listSlots() {
    const userId = this.#userId();
    const records = await Promise.all(ALL_SLOT_IDS.map(async (slotId) => {
      const snapshot = await getDoc(this.#slotReference(userId, slotId));
      return snapshot.exists() ? snapshot.data() : null;
    }));

    return ALL_SLOT_IDS.map((slotId, index) => {
      const record = records[index];
      if (!record) {
        return {
          slotId,
          type: slotId === SAVE_SLOTS.auto ? "auto" : "manual",
          occupied: false,
          savedAt: null,
          progress: null,
        };
      }
      try {
        validateSlotRecord(this.gameData, record, userId, slotId);
        return this.#slotSummary(record);
      } catch (error) {
        return {
          slotId,
          type: slotId === SAVE_SLOTS.auto ? "auto" : "manual",
          occupied: true,
          corrupted: true,
          savedAt: typeof record.savedAt === "string" ? record.savedAt : null,
          progress: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  async load(engine, slotId) {
    if (!ALL_SLOT_IDS.includes(slotId)) {
      throw new RangeError(`Unknown save slot "${String(slotId)}".`);
    }
    const userId = this.#userId();
    const snapshot = await getDoc(this.#slotReference(userId, slotId));
    if (!snapshot.exists()) {
      return null;
    }
    const record = validateSlotRecord(this.gameData, snapshot.data(), userId, slotId);
    engine.restoreState(record.gameState);
    return this.#slotSummary(record);
  }

  async addCollectedEnding(endingId) {
    const userId = this.#userId();
    const knownEndingIds = new Set(
      this.gameData["data/endings/index.yaml"].endings.map((ending) => ending.id),
    );
    if (!knownEndingIds.has(endingId)) {
      throw new RangeError(`Unknown ending "${endingId}".`);
    }
    const reference = doc(this.database, "users", userId, "profile", "endings");
    return runTransaction(this.database, async (transaction) => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.exists()
        ? validateEndingRecord(snapshot.data(), userId, knownEndingIds)
        : { endingIds: [] };
      const endingIds = [...new Set([...existing.endingIds, endingId])];
      transaction.set(reference, {
        profileId: userId,
        formatVersion: SAVE_FORMAT_VERSION,
        endingIds,
        updatedAt: new Date().toISOString(),
      });
      return endingIds;
    });
  }

  async getEndingCollection() {
    const userId = this.#userId();
    const reference = doc(this.database, "users", userId, "profile", "endings");
    const snapshot = await getDoc(reference);
    if (!snapshot.exists()) {
      return { endingIds: [], updatedAt: null };
    }
    const knownEndingIds = new Set(
      this.gameData["data/endings/index.yaml"].endings.map((ending) => ending.id),
    );
    const record = validateEndingRecord(snapshot.data(), userId, knownEndingIds);
    return { endingIds: [...record.endingIds], updatedAt: record.updatedAt };
  }

  async getEndingCompletionRate() {
    const { endingIds } = await this.getEndingCollection();
    const total = this.gameData["data/endings/index.yaml"].endings.length;
    return {
      collected: endingIds.length,
      total,
      rate: total === 0 ? 0 : endingIds.length / total,
    };
  }

  async exportSlotJson(slotId) {
    if (!ALL_SLOT_IDS.includes(slotId)) {
      throw new RangeError(`Unknown save slot "${String(slotId)}".`);
    }
    const userId = this.#userId();
    const snapshot = await getDoc(this.#slotReference(userId, slotId));
    if (!snapshot.exists()) {
      throw new Error(`Save slot "${slotId}" is empty.`);
    }
    const record = validateSlotRecord(this.gameData, snapshot.data(), userId, slotId);
    return JSON.stringify({
      exportFormat: "honey-trap-save",
      formatVersion: SAVE_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      slot: structuredClone(record),
    }, null, 2);
  }

  async importSlotJson(json) {
    const userId = this.#userId();
    const imported = parseSaveExport(this.gameData, json);
    const record = this.#createSlotRecord(
      userId,
      imported.slotId,
      imported.gameState,
      imported.savedAt,
    );
    return this.#writeSlot(record);
  }
}

export function createAutoSaveHandler(repository) {
  if (!repository || typeof repository.saveAutoSnapshot !== "function") {
    throw new TypeError("A save repository with saveAutoSnapshot() is required.");
  }
  return (snapshot) => repository.saveAutoSnapshot(snapshot);
}
