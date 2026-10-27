import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGameData } from "../src/data/validate.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readYaml = (path) => readFile(join(projectRoot, path), "utf8");
const scenarioDirectory = "data/endings/scenarios";
const scenarioFiles = (await readdir(join(projectRoot, scenarioDirectory)))
  .filter((name) => name.endsWith(".yaml"))
  .sort();
const endingScenarios = {};

for (const fileName of scenarioFiles) {
  const fullPath = join(scenarioDirectory, fileName);
  endingScenarios[relative("data/endings", fullPath).replaceAll("\\", "/")] =
    await readYaml(fullPath);
}

const result = loadGameData({
  "data/stages.yaml": await readYaml("data/stages.yaml"),
  "data/events.yaml": await readYaml("data/events.yaml"),
  "data/endings/index.yaml": await readYaml("data/endings/index.yaml"),
  endingScenarios,
});

for (const warning of result.warnings) {
  console.warn(`警告: ${warning}`);
}

if (result.errors.length > 0) {
  for (const error of result.errors) {
    console.error(`エラー: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`ゲームデータの検証に成功しました（${result.data["data/stages.yaml"].stages.length}ステージ）。`);
}
