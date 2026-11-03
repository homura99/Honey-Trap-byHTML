import { validateGameSnapshot } from "../game/save-state.js";

const MANUAL_SLOT_IDS = ["manual-1", "manual-2", "manual-3", "manual-4", "manual-5"];
const AUTO_SLOT_ID = "autosave";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

export function parseSaveExport(gameData, json) {
  let exported;
  try {
    exported = JSON.parse(json);
  } catch (error) {
    throw new Error("JSONファイルを解析できません。", { cause: error });
  }

  if (!isRecord(exported) || exported.exportFormat !== "honey-trap-save" ||
    exported.formatVersion !== 1 || !isRecord(exported.slot)) {
    throw new Error("未対応のセーブJSON形式です。");
  }

  const { slot } = exported;
  const slotIds = [...MANUAL_SLOT_IDS, AUTO_SLOT_ID];
  if (!slotIds.includes(slot.slotId) || slot.formatVersion !== 1) {
    throw new Error("セーブJSONのスロットIDまたは形式バージョンが不正です。");
  }
  if (typeof slot.savedAt !== "string" || Number.isNaN(Date.parse(slot.savedAt))) {
    throw new Error("セーブJSONの保存日時が不正です。");
  }

  const validation = validateGameSnapshot(gameData, slot.gameState);
  if (!validation.valid) {
    throw new Error(`セーブJSONのゲームデータが不正です:\n${validation.errors.join("\n")}`);
  }
  const expectedProgress = progressFor(gameData, slot.gameState);
  if (!isRecord(slot.progress) ||
    Object.keys(expectedProgress).some((key) => slot.progress[key] !== expectedProgress[key])) {
    throw new Error("セーブJSONの進行状況がゲームデータと一致しません。");
  }

  return {
    slotId: slot.slotId,
    savedAt: slot.savedAt,
    gameState: structuredClone(slot.gameState),
    progress: expectedProgress,
  };
}
