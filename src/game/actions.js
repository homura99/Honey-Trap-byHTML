import { applyEffects, getDisplayStamina } from "./effects.js";
import { advanceGameTime, getDisplayTime } from "./time.js";

function getSubscriberGrowth(streamCount, currentSubscribers) {
  let previous = 0;
  let current = 1;
  for (let index = 0; index < streamCount; index += 1) {
    const next = previous + current;
    if (!Number.isSafeInteger(next)) {
      current = Number.MAX_SAFE_INTEGER;
      break;
    }
    previous = current;
    current = next;
  }

  return Math.min(
    Math.floor(current * 0.8),
    Number.MAX_SAFE_INTEGER - currentSubscribers,
  );
}

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
  const effects = action.category === "stream"
    ? {
      ...action.effects,
      parameterChanges: {
        ...action.effects.parameterChanges,
        subscribers: getSubscriberGrowth(state.streamCount, state.subscribers),
      },
    }
    : action.effects;
  applyEffects(gameData, state, effects, difficulty);

  const exhaustionPenalty = staminaShortage *
    gameData["data/settings.yaml"].staminaShortageAffectionPenaltyPerPoint *
    difficulty.exhaustionPenaltyMultiplier;
  if (exhaustionPenalty > 0) {
    const affection = gameData["data/settings.yaml"].parameters.affection;
    state.affection = Math.max(affection.min, state.affection - exhaustionPenalty);
  }

  advanceGameTime(gameData, state, action.timeCostMinutes);
  if (action.category === "stream") {
    state.streamCount = Math.min(state.streamCount + 1, Number.MAX_SAFE_INTEGER);
  }
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

export function previewAction(gameData, state, actionId) {
  const previewState = {
    ...state,
    storyFlags: structuredClone(state.storyFlags),
  };
  const result = executeAction(gameData, previewState, actionId);
  return {
    ...result,
    parameters: {
      affection: previewState.affection,
      stamina: previewState.stamina,
      subscribers: previewState.subscribers,
    },
  };
}
