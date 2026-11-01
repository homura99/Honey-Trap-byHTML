import { SAVE_SCHEMA_VERSION, validateGameSnapshot } from "./save-state.js";

function stageStartMinutes(gameData, stage) {
  const { startTime } = gameData["data/stages.yaml"].schedule;
  return Date.parse(`${stage.startDate}T${startTime}:00Z`) / 60000;
}

export class GameState {
  constructor(gameData, difficultyId) {
    const settings = gameData["data/settings.yaml"];
    const difficulty = settings.difficulty[difficultyId];
    if (!difficulty) {
      throw new RangeError(`Unknown difficulty "${difficultyId}".`);
    }

    const firstStage = gameData["data/stages.yaml"].stages[0];
    if (!firstStage) {
      throw new Error("Game data does not contain a starting stage.");
    }

    this.currentStageIndex = 0;
    this.currentStageId = firstStage.id;
    this.currentTimeMinutes = stageStartMinutes(gameData, firstStage);
    Object.defineProperty(this, "difficultyId", {
      value: difficultyId,
      enumerable: true,
    });
    this.affection = settings.parameters.affection.initial;
    this.stamina = settings.parameters.stamina.initial;
    this.subscribers = settings.parameters.subscribers.initial;
    this.storyFlags = {};
    this.eventHistory = [];
    this.eventCooldowns = {};
    this.pendingEvents = [];
    this.choiceHistory = [];
    this.endingReached = false;
    this.endingId = null;
    this.endingHistory = [];
    this.activeEventId = null;
    this.stageTransitionPending = false;
    this.campaignComplete = false;
  }

  setDifficulty(difficultyId) {
    if (difficultyId !== this.difficultyId) {
      throw new Error("Difficulty cannot be changed after the game has started.");
    }
  }

  snapshot() {
    return structuredClone({
      schemaVersion: SAVE_SCHEMA_VERSION,
      currentStageIndex: this.currentStageIndex,
      currentStageId: this.currentStageId,
      currentTimeMinutes: this.currentTimeMinutes,
      difficultyId: this.difficultyId,
      affection: this.affection,
      stamina: this.stamina,
      subscribers: this.subscribers,
      storyFlags: this.storyFlags,
      eventHistory: this.eventHistory,
      eventCooldowns: this.eventCooldowns,
      pendingEvents: this.pendingEvents,
      choiceHistory: this.choiceHistory,
      endingReached: this.endingReached,
      endingId: this.endingId,
      endingHistory: this.endingHistory,
      activeEventId: this.activeEventId,
      stageTransitionPending: this.stageTransitionPending,
      campaignComplete: this.campaignComplete,
    });
  }
}

export function createGameState(gameData, difficultyId) {
  return new GameState(gameData, difficultyId);
}

export function restoreGameState(gameData, snapshot) {
  const validation = validateGameSnapshot(gameData, snapshot);
  if (!validation.valid) {
    throw new Error(`Invalid game save data:\n${validation.errors.join("\n")}`);
  }

  const state = createGameState(gameData, snapshot.difficultyId);
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== "difficultyId" && key !== "schemaVersion") {
      state[key] = structuredClone(value);
    }
  }
  return state;
}
