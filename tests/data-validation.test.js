import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadGameData } from "../src/data/validate.js";

async function loadSources() {
  return {
    "data/stages.yaml": await readFile(new URL("../data/stages.yaml", import.meta.url), "utf8"),
    "data/events.yaml": await readFile(new URL("../data/events.yaml", import.meta.url), "utf8"),
    "data/endings/index.yaml": await readFile(
      new URL("../data/endings/index.yaml", import.meta.url),
      "utf8",
    ),
    endingScenarios: {
      "scenarios/abandonment.yaml": await readFile(
        new URL("../data/endings/scenarios/abandonment.yaml", import.meta.url),
        "utf8",
      ),
      "scenarios/completion.yaml": await readFile(
        new URL("../data/endings/scenarios/completion.yaml", import.meta.url),
        "utf8",
      ),
    },
  };
}

test("validates the 52-stage sample dataset and all references", async () => {
  const result = loadGameData(await loadSources());

  assert.deepEqual(result.errors, []);
  assert.equal(result.data["data/stages.yaml"].stages.length, 52);
});

test("reports YAML syntax errors as fatal validation errors", async () => {
  const sources = await loadSources();
  sources["data/events.yaml"] = "events: [";

  const result = loadGameData(sources);

  assert.equal(result.data, null);
  assert.ok(result.errors.some((error) => error.includes("data/events.yaml")));
});

test("treats missing required fields as fatal and non-blocking issues as warnings", async () => {
  const missingFieldSources = await loadSources();
  missingFieldSources["data/events.yaml"] = missingFieldSources["data/events.yaml"]
    .replace(/^    priority: 100\r?$/m, "");

  const missingFieldResult = loadGameData(missingFieldSources);
  assert.equal(missingFieldResult.data, null);
  assert.ok(missingFieldResult.errors.some((error) => error.includes('missing required field "priority"')));

  const warningSources = await loadSources();
  warningSources["data/events.yaml"] = warningSources["data/events.yaml"]
    .replace(/^    probability: 1\r?$/m, "    probability: 0");
  const warningResult = loadGameData(warningSources);

  assert.deepEqual(warningResult.errors, []);
  assert.ok(warningResult.data);
  assert.ok(warningResult.warnings.some((warning) => warning.includes("probability is zero")));
});

test("rejects duplicate event IDs and references to missing records", async () => {
  const sources = await loadSources();
  const repeatedEvent = sources["data/events.yaml"].slice(
    sources["data/events.yaml"].indexOf("  - id: sample-arrival"),
  );
  sources["data/events.yaml"] += `\n${repeatedEvent}`;
  sources["data/events.yaml"] = sources["data/events.yaml"]
    .replace("nextEventId: sample-follow-up", "nextEventId: missing-event")
    .replace("      - completion", "      - missing-ending");

  const result = loadGameData(sources);

  assert.ok(result.errors.some((error) => error.includes('duplicate event ID "sample-arrival"')));
  assert.ok(result.errors.some((error) => error.includes('event "missing-event" does not exist')));
  assert.ok(result.errors.some((error) => error.includes('ending "missing-ending" does not exist')));
});

test("rejects invalid parameter names and malformed condition expressions", async () => {
  const sources = await loadSources();
  sources["data/events.yaml"] = sources["data/events.yaml"]
    .replace("parameter: affection", "parameter: popularity")
    .replace("operator: gte", "operator: approximately");

  const result = loadGameData(sources);

  assert.ok(result.errors.some((error) => error.includes('invalid parameter name "popularity"')));
  assert.ok(result.errors.some((error) => error.includes('invalid condition operator "approximately"')));
});

test("rejects unknown condition fields and non-scalar flag values", async () => {
  const sources = await loadSources();
  sources["data/events.yaml"] = sources["data/events.yaml"]
    .replace("          operator: gte", "          unexpected: true\n          operator: gte")
    .replace("          value: true", "          value: { invalid: true }");

  const result = loadGameData(sources);

  assert.ok(result.errors.some((error) => error.includes('unexpected condition field "unexpected"')));
  assert.ok(result.errors.some((error) => error.includes("flag conditions require scalar values")));
});
