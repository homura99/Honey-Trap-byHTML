import { evaluateCondition } from "./conditions.js";

export function evaluateEnding(gameData, state, timing) {
  if (state.endingReached) {
    return null;
  }

  const endings = gameData["data/endings/index.yaml"].endings;
  for (const ending of endings) {
    const trigger = ending.trigger;
    if (trigger.timing !== timing) {
      continue;
    }
    if (timing === "stageEnd" &&
      gameData["data/stages.yaml"].stages[state.currentStageIndex].number !== trigger.stageNumber) {
      continue;
    }
    if (!evaluateCondition(trigger.condition, state)) {
      continue;
    }

    state.endingReached = true;
    state.endingId = ending.id;
    state.endingHistory.push(ending.id);
    return {
      endingId: ending.id,
      title: ending.title,
      scenario: gameData.endingScenarios[ending.scenario],
      resultReady: true,
    };
  }
  return null;
}
