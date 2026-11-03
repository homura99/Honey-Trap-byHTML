import { validateGameSnapshot } from "../game/save-state.js";

const DATABASE_NAME = "honey-trap-saves";
const DATABASE_VERSION = 1;
const SAVE_FORMAT_VERSION = 1;
const STORE_SLOTS = "slots";
const STORE_ENDINGS = "endings";
const MANUAL_SLOT_IDS = ["manual-1", "manual-2", "manual-3", "manual-4", "manual-5"];
const AUTO_SLOT_ID = "autosave";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateProfileId(profileId) {
  if (typeof profileId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(profileId)) {
    throw new TypeError("Profile ID must contain 1 to 128 letters, digits, underscores, or hyphens.");
  }
}

function validateSlotId(slotId) {
  if (![...MANUAL_SLOT_IDS, AUTO_SLOT_ID].includes(slotId)) {
    throw new RangeError(`Unknown save slot "${String(slotId)}".`);
  }
}

function slotKey(profileId, slotId) {
  return `${profileId}::${slotId}`;
}

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

function validateSlotRecord(gameData, record, expectedProfileId, expectedSlotId) {
  if (!isRecord(record)) {
    throw new Error("Save slot record is corrupt: expected an object.");
  }
  if (record.formatVersion !== SAVE_FORMAT_VERSION) {
    throw new Error(`Unsupported save format version "${String(record.formatVersion)}".`);
  }
  if (record.profileId !== expectedProfileId || record.slotId !== expectedSlotId ||
    record.key !== slotKey(expectedProfileId, expectedSlotId)) {
    throw new Error("Save slot identity does not match the requested slot.");
  }
  if (typeof record.savedAt !== "string" || Number.isNaN(Date.parse(record.savedAt))) {
    throw new Error("Save timestamp is missing or invalid.");
  }

  const validation = validateGameSnapshot(gameData, record.gameState);
  if (!validation.valid) {
    throw new Error(`Save data is corrupt:\n${validation.errors.join("\n")}`);
  }
  const expectedProgress = progressFor(gameData, record.gameState);
  if (!isRecord(record.progress) ||
    Object.keys(expectedProgress).some((key) => record.progress[key] !== expectedProgress[key])) {
    throw new Error("Save progress summary does not match its game state.");
  }
  return record;
}

function validateEndingRecord(record, profileId, endingIds) {
  if (!isRecord(record) || record.profileId !== profileId ||
    record.formatVersion !== SAVE_FORMAT_VERSION || !Array.isArray(record.endingIds) ||
    typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt)) ||
    record.endingIds.some((endingId) => !endingIds.has(endingId)) ||
    new Set(record.endingIds).size !== record.endingIds.length) {
    throw new Error("Ending collection record is corrupt or uses an unsupported version.");
  }
  return record;
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export class IndexedDBSaveRepository {
  constructor(gameData, options = {}) {
    this.gameData = gameData;
    this.indexedDB = options.indexedDB ?? globalThis.indexedDB;
    this.databaseName = options.databaseName ?? DATABASE_NAME;
    this.profileId = options.profileId ?? "guest";
    validateProfileId(this.profileId);
    if (!this.indexedDB) {
      throw new Error("IndexedDB is not available in this environment.");
    }
    this.databasePromise = null;
  }

  async #openDatabase() {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(this.databaseName, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_SLOTS)) {
            database.createObjectStore(STORE_SLOTS, { keyPath: "key" });
          }
          if (!database.objectStoreNames.contains(STORE_ENDINGS)) {
            database.createObjectStore(STORE_ENDINGS, { keyPath: "profileId" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Could not open save database."));
        request.onblocked = () => reject(new Error("Opening the save database was blocked."));
      }).catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }

  async #read(storeName, key) {
    const database = await this.#openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    const transactionFinished = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB read failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB read was aborted."));
    });
    const result = await requestPromise(transaction.objectStore(storeName).get(key));
    await transactionFinished;
    return result;
  }

  async #putIfValid(storeName, key, record, validateExisting) {
    const database = await this.#openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      let operationError = null;
      let result;

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(
        operationError ?? transaction.error ?? new Error("IndexedDB write failed."),
      );
      transaction.onabort = () => reject(
        operationError ?? transaction.error ?? new Error("IndexedDB write was aborted."),
      );

      const request = store.get(key);
      request.onerror = () => {
        operationError = request.error ?? new Error("Could not inspect the existing save.");
        transaction.abort();
      };
      request.onsuccess = () => {
        try {
          if (request.result) {
            validateExisting(request.result);
            const previousTimestamp = Date.parse(request.result.savedAt);
            if (Date.parse(record.savedAt) <= previousTimestamp) {
              record.savedAt = new Date(previousTimestamp + 1).toISOString();
            }
          }
          store.put(record);
          result = record;
        } catch (error) {
          operationError = error;
          transaction.abort();
        }
      };
    });
  }

  #createSlotRecord(slotId, snapshot) {
    const validation = validateGameSnapshot(this.gameData, snapshot);
    if (!validation.valid) {
      throw new Error(`Cannot save invalid game state:\n${validation.errors.join("\n")}`);
    }
    return {
      key: slotKey(this.profileId, slotId),
      profileId: this.profileId,
      slotId,
      formatVersion: SAVE_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      progress: progressFor(this.gameData, snapshot),
      gameState: structuredClone(snapshot),
    };
  }

  async #saveSnapshot(slotId, snapshot) {
    validateSlotId(slotId);
    const record = this.#createSlotRecord(slotId, snapshot);
    await this.#putIfValid(
      STORE_SLOTS,
      record.key,
      record,
      (existing) => validateSlotRecord(this.gameData, existing, this.profileId, slotId),
    );
    return this.#slotSummary(record);
  }

  #slotSummary(record) {
    return {
      slotId: record.slotId,
      type: record.slotId === AUTO_SLOT_ID ? "auto" : "manual",
      occupied: true,
      savedAt: record.savedAt,
      progress: structuredClone(record.progress),
    };
  }

  async saveManual(engine, slotId) {
    validateSlotId(slotId);
    if (slotId === AUTO_SLOT_ID) {
      throw new RangeError("Manual saves cannot use the auto-save slot.");
    }
    if (!engine.canSave) {
      throw new Error("Manual saving is only allowed at a safe game state.");
    }
    return this.#saveSnapshot(slotId, engine.createSaveSnapshot());
  }

  async saveAutoSnapshot(snapshot) {
    return this.#saveSnapshot(AUTO_SLOT_ID, snapshot);
  }

  async saveAuto(engine) {
    return this.saveAutoSnapshot(engine.createSaveSnapshot());
  }

  async listSlots() {
    const entries = [...MANUAL_SLOT_IDS, AUTO_SLOT_ID];
    return Promise.all(entries.map(async (slotId) => {
      const record = await this.#read(STORE_SLOTS, slotKey(this.profileId, slotId));
      if (!record) {
        return {
          slotId,
          type: slotId === AUTO_SLOT_ID ? "auto" : "manual",
          occupied: false,
          savedAt: null,
          progress: null,
        };
      }
      try {
        validateSlotRecord(this.gameData, record, this.profileId, slotId);
        return this.#slotSummary(record);
      } catch (error) {
        return {
          slotId,
          type: slotId === AUTO_SLOT_ID ? "auto" : "manual",
          occupied: true,
          corrupted: true,
          savedAt: typeof record.savedAt === "string" ? record.savedAt : null,
          progress: null,
          error: error.message,
        };
      }
    }));
  }

  async load(engine, slotId) {
    validateSlotId(slotId);
    const record = await this.#read(STORE_SLOTS, slotKey(this.profileId, slotId));
    if (!record) {
      return null;
    }
    validateSlotRecord(this.gameData, record, this.profileId, slotId);
    engine.restoreState(record.gameState);
    return this.#slotSummary(record);
  }

  async addCollectedEnding(endingId) {
    const endingIds = new Set(
      this.gameData["data/endings/index.yaml"].endings.map((ending) => ending.id),
    );
    if (!endingIds.has(endingId)) {
      throw new RangeError(`Unknown ending "${endingId}".`);
    }
    const database = await this.#openDatabase();
    const storeName = STORE_ENDINGS;
    const now = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      let operationError = null;
      let endingRecord;

      transaction.oncomplete = () => resolve(structuredClone(endingRecord.endingIds));
      transaction.onerror = () => reject(
        operationError ?? transaction.error ?? new Error("Could not update ending collection."),
      );
      transaction.onabort = () => reject(
        operationError ?? transaction.error ?? new Error("Ending collection update was aborted."),
      );

      const request = store.get(this.profileId);
      request.onerror = () => {
        operationError = request.error ?? new Error("Could not read ending collection.");
        transaction.abort();
      };
      request.onsuccess = () => {
        try {
          const existing = request.result
            ? validateEndingRecord(request.result, this.profileId, endingIds)
            : { endingIds: [] };
          endingRecord = {
            profileId: this.profileId,
            formatVersion: SAVE_FORMAT_VERSION,
            endingIds: [...new Set([...existing.endingIds, endingId])],
            updatedAt: now,
          };
          store.put(endingRecord);
        } catch (error) {
          operationError = error;
          transaction.abort();
        }
      };
    });
  }

  async getEndingCollection() {
    const endingIds = new Set(
      this.gameData["data/endings/index.yaml"].endings.map((ending) => ending.id),
    );
    const record = await this.#read(STORE_ENDINGS, this.profileId);
    if (!record) {
      return { endingIds: [], updatedAt: null };
    }
    validateEndingRecord(record, this.profileId, endingIds);
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
    validateSlotId(slotId);
    const record = await this.#read(STORE_SLOTS, slotKey(this.profileId, slotId));
    if (!record) {
      throw new Error(`Save slot "${slotId}" is empty.`);
    }
    validateSlotRecord(this.gameData, record, this.profileId, slotId);

    return JSON.stringify({
      exportFormat: "honey-trap-save",
      formatVersion: SAVE_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      slot: structuredClone(record),
    }, null, 2);
  }

  close() {
    if (!this.databasePromise) {
      return Promise.resolve();
    }

    const databasePromise = this.databasePromise;
    this.databasePromise = null;
    return databasePromise.then((database) => {
      if (typeof database.close === "function") {
        database.close();
      }
    });
  }
}

export function createSaveRepository(options) {
  return new IndexedDBSaveRepository(options.gameData, options);
}

export function createAutoSaveHandler(repository) {
  if (!repository || typeof repository.saveAutoSnapshot !== "function") {
    throw new TypeError("A save repository with saveAutoSnapshot() is required.");
  }
  return (snapshot) => repository.saveAutoSnapshot(snapshot);
}

export const SAVE_SLOTS = Object.freeze({
  manual: Object.freeze([...MANUAL_SLOT_IDS]),
  auto: AUTO_SLOT_ID,
});
