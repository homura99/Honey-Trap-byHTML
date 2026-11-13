import { executeAction, previewAction } from "./actions.js";
import {
  completeEventWithoutChoice,
  deferActiveEvent,
  getAvailableEvents,
  resolveEventChoice,
  selectNextEvent,
  startEvent,
} from "./events.js";
import { evaluateEnding } from "./endings.js";
import { createGameState, restoreGameState } from "./state.js";
import { advanceToNextStage, getDisplayTime } from "./time.js";

export class GameEngine {
  constructor(gameData, difficultyId, options = {}) {
    this.gameData = gameData;
    this.state = createGameState(gameData, difficultyId);
    this.random = options.random ?? Math.random;
    this.autoSaveHandler = options.autoSave ?? null;
  }

  get canSave() {
    return this.state.activeEventId === null && !this.state.stageTransitionPending;
  }

  createSaveSnapshot() {
    return this.state.snapshot();
  }

  restoreState(snapshot) {
    this.state = restoreGameState(this.gameData, snapshot);
  }

  setAutoSaveHandler(handler) {
    if (handler !== null && typeof handler !== "function") {
      throw new TypeError("Auto-save handler must be a function or null.");
    }
    this.autoSaveHandler = handler;
  }

  async #autoSave(reason) {
    if (!this.autoSaveHandler) {
      return null;
    }
    try {
      const saved = await this.autoSaveHandler(this.createSaveSnapshot(), { reason });
      return { success: true, saved };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getTime() {
    return getDisplayTime(this.gameData, this.state);
  }

  setDifficulty(difficultyId) {
    this.state.setDifficulty(difficultyId);
  }

  async performAction(actionId) {
    const result = executeAction(this.gameData, this.state, actionId);
    const immediateEnding = evaluateEnding(this.gameData, this.state, "immediate");
    const operationResult = { ...result, ending: immediateEnding };
    const autoSave = await this.#autoSave("action");
    return { ...operationResult, autoSave };
  }

  previewAction(actionId) {
    return previewAction(this.gameData, this.state, actionId);
  }

  getAvailableEvents() {
    return getAvailableEvents(this.gameData, this.state);
  }

  selectNextEvent() {
    const event = selectNextEvent(this.gameData, this.state, this.random);
    return event
      ? startEvent(this.gameData, this.state, event.id, () => 0)
      : null;
  }

  startEvent(eventId) {
    return startEvent(this.gameData, this.state, eventId, this.random);
  }

  chooseEventOption(choiceId) {
    return resolveEventChoice(this.gameData, this.state, choiceId);
  }

  completeEvent() {
    return completeEventWithoutChoice(this.gameData, this.state);
  }

  deferEvent() {
    return deferActiveEvent(this.gameData, this.state);
  }

  async confirmStageTransition() {
    if (this.state.endingReached) {
      return {
        advanced: false,
        endingId: this.state.endingId,
        resultReady: true,
      };
    }
    if (!this.state.stageTransitionPending) {
      throw new Error("There is no stage transition to confirm.");
    }

    const ending = evaluateEnding(this.gameData, this.state, "stageEnd");
    if (ending) {
      return { advanced: false, ending, resultReady: true };
    }
    const transition = advanceToNextStage(this.gameData, this.state);
    if (transition.advanced) {
      return { ...transition, autoSave: await this.#autoSave("stage-transition", transition) };
    }
    return transition;
  }
}
