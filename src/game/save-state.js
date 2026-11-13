const SAVE_SCHEMA_VERSION = 1;
const EVENT_STATUSES = new Set(["started", "deferred", "completed"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasScalarValues(record) {
  return isRecord(record) && Object.values(record).every((value) =>
    value === null || ["boolean", "number", "string"].includes(typeof value));
}

export function validateGameSnapshot(gameData, snapshot) {
  const errors = [];
  const fail = (message) => errors.push(message);

  if (!isRecord(snapshot)) {
    return { valid: false, errors: ["Game state must be an object."] };
  }
  if (snapshot.schemaVersion !== SAVE_SCHEMA_VERSION) {
    fail(`Unsupported game state version "${String(snapshot.schemaVersion)}".`);
  }

  const stages = gameData["data/stages.yaml"].stages;
  const events = gameData["data/events.yaml"].events;
  const endings = gameData["data/endings/index.yaml"].endings;
  const settings = gameData["data/settings.yaml"];
  const stage = stages[snapshot.currentStageIndex];
  if (!Number.isInteger(snapshot.currentStageIndex) || !stage ||
    stage.id !== snapshot.currentStageId) {
    fail("Current stage ID and index do not identify a configured stage.");
  }
  if (!Number.isSafeInteger(snapshot.currentTimeMinutes)) {
    fail("Current time must be a safe integer minute value.");
  }
  if (!settings.difficulty[snapshot.difficultyId]) {
    fail(`Unknown difficulty "${String(snapshot.difficultyId)}".`);
  }
  if (typeof snapshot.affection !== "number" || !Number.isFinite(snapshot.affection) ||
    snapshot.affection < settings.parameters.affection.min ||
    snapshot.affection > settings.parameters.affection.max) {
    fail("Affection is outside the configured range.");
  }
  if (typeof snapshot.stamina !== "number" || !Number.isFinite(snapshot.stamina)) {
    fail("Stamina must be a finite number.");
  }
  if (!Number.isSafeInteger(snapshot.subscribers) || snapshot.subscribers < 0) {
    fail("Subscribers must be a non-negative safe integer.");
  }
  if (snapshot.streamCount !== undefined &&
    (!Number.isSafeInteger(snapshot.streamCount) || snapshot.streamCount < 0)) {
    fail("Stream count must be a non-negative safe integer.");
  }
  if (!hasScalarValues(snapshot.storyFlags)) {
    fail("Story flags must be an object containing scalar values.");
  }
  if (!Array.isArray(snapshot.eventHistory)) {
    fail("Event history must be an array.");
  } else {
    for (const [index, entry] of snapshot.eventHistory.entries()) {
      if (!isRecord(entry) || !events.some((event) => event.id === entry.eventId) ||
        !EVENT_STATUSES.has(entry.status) || !Number.isInteger(entry.stageNumber) ||
        entry.stageNumber < 1 || entry.stageNumber > stages.length) {
        fail(`Event history entry ${index} is invalid.`);
      }
    }
  }
  if (!isRecord(snapshot.eventCooldowns)) {
    fail("Event cooldown state must be an object.");
  } else {
    for (const [eventId, stageNumber] of Object.entries(snapshot.eventCooldowns)) {
      const event = events.find((entry) => entry.id === eventId);
      if (!event || event.repeatPolicy.mode !== "cooldown" ||
        !Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > stages.length) {
        fail(`Event cooldown state for "${eventId}" is invalid.`);
      }
    }
  }
  if (!Array.isArray(snapshot.pendingEvents)) {
    fail("Pending events must be an array.");
  } else {
    const pendingIds = new Set();
    for (const [index, pending] of snapshot.pendingEvents.entries()) {
      if (!isRecord(pending) || !events.some((event) => event.id === pending.eventId) ||
        !Number.isInteger(pending.deferredAtStage) ||
        pending.deferredAtStage < 1 || pending.deferredAtStage > stages.length ||
        pendingIds.has(pending.eventId)) {
        fail(`Pending event entry ${index} is invalid.`);
      } else {
        pendingIds.add(pending.eventId);
      }
    }
  }
  if (!Array.isArray(snapshot.choiceHistory)) {
    fail("Choice history must be an array.");
  } else {
    for (const [index, choice] of snapshot.choiceHistory.entries()) {
      const event = isRecord(choice) ? events.find((entry) => entry.id === choice.eventId) : null;
      if (!event || !event.choices.some((entry) => entry.id === choice.choiceId)) {
        fail(`Choice history entry ${index} is invalid.`);
      }
    }
  }
  if (typeof snapshot.endingReached !== "boolean" ||
    !Array.isArray(snapshot.endingHistory) ||
    snapshot.endingHistory.some((endingId) => !endings.some((ending) => ending.id === endingId))) {
    fail("Ending state or ending history is invalid.");
  }
  if (snapshot.endingReached) {
    if (!endings.some((ending) => ending.id === snapshot.endingId)) {
      fail("Reached ending ID does not exist.");
    }
  } else if (snapshot.endingId !== null) {
    fail("Ending ID must be null before an ending is reached.");
  }
  if (snapshot.activeEventId !== null) {
    fail("A save cannot contain an event that is still being processed.");
  }
  if (typeof snapshot.stageTransitionPending !== "boolean" ||
    typeof snapshot.campaignComplete !== "boolean") {
    fail("Stage transition and campaign completion flags must be booleans.");
  }
  if (snapshot.campaignComplete && snapshot.currentStageIndex !== stages.length - 1) {
    fail("Campaign completion can only be recorded on the final stage.");
  }

  return { valid: errors.length === 0, errors };
}

export { SAVE_SCHEMA_VERSION };
