import { evaluateCondition } from "./conditions.js";
import { applyEffects } from "./effects.js";
import { evaluateEnding } from "./endings.js";

function isRepeatAllowed(event, state, currentStageNumber) {
  const records = state.eventHistory.filter((record) =>
    record.eventId === event.id && record.status === "completed");
  if (event.repeatPolicy.mode === "once") {
    return records.length === 0;
  }
  if (event.repeatPolicy.mode === "cooldown") {
    const completedAtStage = state.eventCooldowns[event.id] ??
      records.at(-1)?.stageNumber;
    return completedAtStage === undefined ||
      currentStageNumber - completedAtStage >= event.repeatPolicy.cooldownStages;
  }
  return true;
}

function getPendingEvent(state, eventId) {
  return state.pendingEvents.find((entry) => entry.eventId === eventId);
}

function canPresent(event, state, currentStageNumber) {
  const pending = getPendingEvent(state, event.id);
  if (!pending && event.stageId !== state.currentStageId) {
    return false;
  }
  if (state.activeEventId === event.id || !isRepeatAllowed(event, state, currentStageNumber)) {
    return false;
  }
  if (!evaluateCondition(event.condition, state)) {
    return false;
  }
  return !pending || evaluateCondition(event.deferPolicy.retryCondition, state);
}

export function getAvailableEvents(gameData, state) {
  if (state.endingReached || state.stageTransitionPending || state.activeEventId) {
    return [];
  }
  const events = gameData["data/events.yaml"].events;
  const stage = gameData["data/stages.yaml"].stages[state.currentStageIndex];
  const weight = gameData["data/settings.yaml"].eventSelection.uncollectedEndingWeight;

  return events
    .map((event, index) => {
      const uncollectedEndingCount = event.relatedEndingIds.filter(
        (endingId) => !state.endingHistory.includes(endingId),
      ).length;
      return {
        event,
        index,
        score: event.priority + uncollectedEndingCount * weight,
      };
    })
    .filter(({ event }) => canPresent(event, state, stage.number))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ event, score }) => ({ ...event, selectionScore: score }));
}

export function selectNextEvent(gameData, state, random = Math.random) {
  for (const event of getAvailableEvents(gameData, state)) {
    if (random() < event.probability) {
      return event;
    }
  }
  return null;
}

export function startEvent(gameData, state, eventId, random = Math.random) {
  const event = getAvailableEvents(gameData, state).find(({ id }) => id === eventId);
  if (!event) {
    throw new Error(`Event "${eventId}" is not currently available.`);
  }
  if (random() >= event.probability) {
    return null;
  }

  state.activeEventId = event.id;
  state.eventHistory.push({
    eventId: event.id,
    status: "started",
    stageNumber: gameData["data/stages.yaml"].stages[state.currentStageIndex].number,
  });
  return { ...event, timeAdvanced: false };
}

function finishEvent(gameData, state, event, stageNumber) {
  state.eventHistory.push({
    eventId: event.id,
    status: "completed",
    stageNumber,
  });
  if (event.repeatPolicy.mode === "cooldown") {
    state.eventCooldowns[event.id] = stageNumber;
  }
  state.pendingEvents = state.pendingEvents.filter(({ eventId }) => eventId !== event.id);
  state.activeEventId = null;
  return evaluateEnding(gameData, state, "immediate");
}

export function resolveEventChoice(gameData, state, choiceId) {
  const event = gameData["data/events.yaml"].events.find(({ id }) => id === state.activeEventId);
  if (!event) {
    throw new Error("There is no active event.");
  }
  const choice = event.choices.find(({ id }) => id === choiceId);
  if (!choice) {
    throw new RangeError(`Choice "${choiceId}" does not exist in event "${event.id}".`);
  }

  const stageNumber = gameData["data/stages.yaml"].stages[state.currentStageIndex].number;
  state.choiceHistory.push({ eventId: event.id, choiceId });
  applyEffects(
    gameData,
    state,
    choice.effects,
    gameData["data/settings.yaml"].difficulty[state.difficultyId],
  );
  const ending = finishEvent(gameData, state, event, stageNumber);
  return {
    eventId: event.id,
    choiceId: choice.id,
    nextEventId: ending ? null : choice.nextEventId ?? null,
    ending,
    timeAdvanced: false,
  };
}

export function completeEventWithoutChoice(gameData, state) {
  const event = gameData["data/events.yaml"].events.find(({ id }) => id === state.activeEventId);
  if (!event) {
    throw new Error("There is no active event.");
  }
  if (event.choices.length > 0) {
    throw new Error(`Event "${event.id}" still has unresolved choices.`);
  }

  const stageNumber = gameData["data/stages.yaml"].stages[state.currentStageIndex].number;
  const ending = finishEvent(gameData, state, event, stageNumber);
  return { eventId: event.id, ending, timeAdvanced: false };
}

export function deferActiveEvent(gameData, state) {
  const event = gameData["data/events.yaml"].events.find(({ id }) => id === state.activeEventId);
  if (!event) {
    throw new Error("There is no active event.");
  }
  if (!event.deferPolicy.enabled) {
    throw new Error(`Event "${event.id}" cannot be deferred.`);
  }

  const stageNumber = gameData["data/stages.yaml"].stages[state.currentStageIndex].number;
  if (!getPendingEvent(state, event.id)) {
    state.pendingEvents.push({ eventId: event.id, deferredAtStage: stageNumber });
  }
  state.eventHistory.push({ eventId: event.id, status: "deferred", stageNumber });
  state.activeEventId = null;
  return { eventId: event.id, deferred: true, timeAdvanced: false };
}
