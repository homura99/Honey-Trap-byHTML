export function toGameMinutes(date, time) {
  return Date.parse(`${date}T${time}:00Z`) / 60000;
}

export function getStageBounds(gameData, stage) {
  const schedule = gameData["data/stages.yaml"].schedule;
  return {
    start: toGameMinutes(stage.startDate, schedule.startTime),
    end: toGameMinutes(stage.endDate, schedule.endTime),
  };
}

export function getDisplayTime(gameData, state) {
  const stage = gameData["data/stages.yaml"].stages[state.currentStageIndex];
  const current = new Date(state.currentTimeMinutes * 60000);
  const timeOfDay = current.toISOString().slice(11, 16);
  const hour = current.getUTCHours();
  const period = hour < 6 ? "深夜" : hour < 12 ? "朝" : hour < 18 ? "昼" : "夜";

  return {
    stageId: stage.id,
    stageTitle: stage.title,
    date: current.toISOString().slice(0, 10),
    time: timeOfDay,
    period,
    absoluteMinutes: state.currentTimeMinutes,
  };
}

export function advanceGameTime(gameData, state, minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new RangeError("Time cost must be a non-negative integer number of minutes.");
  }

  state.currentTimeMinutes += minutes;
  const stage = gameData["data/stages.yaml"].stages[state.currentStageIndex];
  const bounds = getStageBounds(gameData, stage);
  if (state.currentTimeMinutes >= bounds.end) {
    state.stageTransitionPending = true;
  }
}

export function advanceToNextStage(gameData, state) {
  if (!state.stageTransitionPending) {
    throw new Error("The current stage has not reached its end.");
  }

  const nextIndex = state.currentStageIndex + 1;
  const stages = gameData["data/stages.yaml"].stages;
  if (nextIndex >= stages.length) {
    state.campaignComplete = true;
    return { advanced: false, campaignComplete: true, stageId: state.currentStageId };
  }

  const nextStage = stages[nextIndex];
  const nextBounds = getStageBounds(gameData, nextStage);
  state.currentStageIndex = nextIndex;
  state.currentStageId = nextStage.id;
  state.currentTimeMinutes = Math.max(state.currentTimeMinutes, nextBounds.start);
  state.stageTransitionPending = state.currentTimeMinutes >= nextBounds.end;

  return {
    advanced: true,
    campaignComplete: false,
    stageId: nextStage.id,
    currentTimeMinutes: state.currentTimeMinutes,
    stageTransitionPending: state.stageTransitionPending,
  };
}
