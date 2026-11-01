import actions from "../../data/actions.yaml?raw";
import endingsIndex from "../../data/endings/index.yaml?raw";
import events from "../../data/events.yaml?raw";
import settings from "../../data/settings.yaml?raw";
import stages from "../../data/stages.yaml?raw";
import { loadGameData } from "./validate.js";

const endingScenarioFiles = import.meta.glob("../../data/endings/scenarios/*.yaml", {
  eager: true,
  import: "default",
  query: "?raw",
});

const result = loadGameData({
  "data/stages.yaml": stages,
  "data/settings.yaml": settings,
  "data/actions.yaml": actions,
  "data/events.yaml": events,
  "data/endings/index.yaml": endingsIndex,
  endingScenarios: Object.fromEntries(
    Object.entries(endingScenarioFiles).map(([path, source]) => [
      `scenarios/${path.split("/").at(-1)}`,
      source,
    ]),
  ),
});

if (result.errors.length > 0) {
  throw new Error(`ゲームデータの検証に失敗しました:\n${result.errors.join("\n")}`);
}

for (const warning of result.warnings) {
  console.warn(`[ゲームデータ警告] ${warning}`);
}

export const gameData = result.data;
