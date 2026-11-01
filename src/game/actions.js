import { applyEffects, getDisplayStamina } from "./effects.js";
import { advanceGameTime, getDisplayTime } from "./time.js";

export function executeAction(gameData, state, actionId) {
  if (state.endingReached || state.campaignComplete) {
    throw new Error("Actions cannot be performed after the campaign has ended.");
  }
  if (state.stageTransitionPending) {
    throw new Error("Confirm the stage transition before performing another action.");
  }
  if (state.activeEventId) {
    throw new Error("Resolve or defer the active event before performing an action.");
  }

  const action = gameData["data/actions.yaml"].actions.find(({ id }) => id === actionId);
  if (!action) {
    throw new RangeError(`Unknown action "${actionId}".`);
  }

  const difficulty = gameData["data/settings.yaml"].difficulty[state.difficultyId];
  const staminaCost = action.staminaCost * difficulty.staminaCostMultiplier;
  const staminaShortage = Math.max(0, staminaCost - Math.max(0, state.stamina));
  const parametersBefore = {
    affection: state.affection,
    stamina: state.stamina,
    subscribers: state.subscribers,
  };
  state.stamina -= staminaCost;
  applyEffects(gameData, state, action.effects, difficulty);

  const exhaustionPenalty = staminaShortage *
    gameData["data/settings.yaml"].staminaShortageAffectionPenaltyPerPoint *
    difficulty.exhaustionPenaltyMultiplier;
  if (exhaustionPenalty > 0) {
    const affection = gameData["data/settings.yaml"].parameters.affection;
    state.affection = Math.max(affection.min, state.affection - exhaustionPenalty);
  }

  advanceGameTime(gameData, state, action.timeCostMinutes);
  return {
    actionId: action.id,
    category: action.category,
    label: action.label,
    timeCostMinutes: action.timeCostMinutes,
    staminaCost,
    staminaShortage,
    exhaustionPenalty,
    parameterChanges: Object.fromEntries(
      Object.keys(parametersBefore).map((parameter) => [
        parameter,
        state[parameter] - parametersBefore[parameter],
      ]),
    ),
    displayStamina: getDisplayStamina(gameData, state),
    time: getDisplayTime(gameData, state),
    stageTransitionPending: state.stageTransitionPending,
  };
}
