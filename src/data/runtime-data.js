import abandonmentScenario from "../../data/endings/scenarios/abandonment.yaml?raw";
import completionScenario from "../../data/endings/scenarios/completion.yaml?raw";
import endingsIndex from "../../data/endings/index.yaml?raw";
import events from "../../data/events.yaml?raw";
import stages from "../../data/stages.yaml?raw";
import { loadGameData } from "./validate.js";

const result = loadGameData({
  "data/stages.yaml": stages,
  "data/events.yaml": events,
  "data/endings/index.yaml": endingsIndex,
  endingScenarios: {
    "scenarios/abandonment.yaml": abandonmentScenario,
    "scenarios/completion.yaml": completionScenario,
  },
});

if (result.errors.length > 0) {
  throw new Error(`ゲームデータの検証に失敗しました:\n${result.errors.join("\n")}`);
}

for (const warning of result.warnings) {
  console.warn(`[ゲームデータ警告] ${warning}`);
}

export const gameData = result.data;
