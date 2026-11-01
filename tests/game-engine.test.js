import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { loadGameData } from "../src/data/validate.js";
import { evaluateCondition } from "../src/game/conditions.js";
import { GameEngine } from "../src/game/engine.js";
import { createGameState } from "../src/game/state.js";
import { getStageBounds } from "../src/game/time.js";

async function loadGameDataFixture() {
  const root = new URL("../data/", import.meta.url);
  const scenarioDirectory = new URL("../data/endings/scenarios/", import.meta.url);
  const endingScenarios = {};
  const scenarioNames = await readdir(scenarioDirectory);

  for (const name of scenarioNames.filter((entry) => entry.endsWith(".yaml"))) {
    endingScenarios[`scenarios/${name}`] = await readFile(new URL(name, scenarioDirectory), "utf8");
  }

  const result = loadGameData({
    "data/stages.yaml": await readFile(new URL("stages.yaml", root), "utf8"),
    "data/settings.yaml": await readFile(new URL("settings.yaml", root), "utf8"),
    "data/actions.yaml": await readFile(new URL("actions.yaml", root), "utf8"),
    "data/events.yaml": await readFile(new URL("events.yaml", root), "utf8"),
    "data/endings/index.yaml": await readFile(new URL("endings/index.yaml", root), "utf8"),
    endingScenarios,
  });
  assert.deepEqual(result.errors, []);
  return result.data;
}

test("initializes game state with configured defaults and locks difficulty", async () => {
  const data = await loadGameDataFixture();
  const state = createGameState(data, "sweet");

  assert.equal(state.currentStageId, "stage-01");
  assert.equal(state.affection, 10);
  assert.equal(state.stamina, 100);
  assert.equal(state.subscribers, 1);
  assert.equal(state.difficultyId, "sweet");
  assert.throws(() => state.setDifficulty("spicy"), /cannot be changed/);
  assert.doesNotThrow(() => state.setDifficulty("sweet"));
  assert.throws(() => {
    state.difficultyId = "spicy";
  }, TypeError);
});

test("evaluates combined AND and OR condition groups", () => {
  const state = { affection: 10, storyFlags: { unlocked: false, alternate: true } };
  const condition = {
    all: [{ parameter: "affection", operator: "gte", value: 10 }],
    any: [
      { flag: "unlocked", operator: "eq", value: true },
      { flag: "alternate", operator: "eq", value: true },
    ],
  };

  assert.equal(evaluateCondition(condition, state), true);
  state.affection = 9;
  assert.equal(evaluateCondition(condition, state), false);
});

test("applies action costs, shortage penalties, parameter bounds, and returns display results", async () => {
  const data = await loadGameDataFixture();
  const engine = new GameEngine(data, "sweet");
  engine.state.stamina = 2;
  engine.state.affection = 99;

  const result = await engine.performAction("stream");

  assert.equal(result.timeCostMinutes, 120);
  assert.equal(result.staminaShortage, 28);
  assert.ok(Math.abs(result.exhaustionPenalty - 2.8) < Number.EPSILON * 16);
  assert.equal(engine.state.stamina, -28);
  assert.equal(result.displayStamina, 0);
  assert.ok(Math.abs(engine.state.affection - 97.2) < Number.EPSILON * 16);
  assert.equal(engine.state.subscribers, 6);
  assert.equal(result.parameterChanges.stamina, -30);
  assert.ok(Math.abs(result.parameterChanges.affection + 1.8) < Number.EPSILON * 16);
  assert.equal(result.parameterChanges.subscribers, 5);
  assert.equal(result.time.time, "02:00");

  const cappedEngine = new GameEngine(data, "sweet");
  cappedEngine.state.affection = 99;
  await cappedEngine.performAction("conversation");
  assert.equal(cappedEngine.state.affection, 100);
});

test("moves between stages only after confirmation and preserves time overrun", async () => {
  const data = await loadGameDataFixture();
  const engine = new GameEngine(data, "sweet");
  const firstBounds = getStageBounds(data, data["data/stages.yaml"].stages[0]);
  engine.state.currentTimeMinutes = firstBounds.end - 30;

  const actionResult = await engine.performAction("conversation");
  assert.equal(actionResult.stageTransitionPending, true);
  assert.equal(engine.state.currentStageId, "stage-01");
  const transition = await engine.confirmStageTransition();
  assert.equal(transition.stageId, "stage-02");
  assert.equal(engine.state.currentStageId, "stage-02");

  const nextEngine = new GameEngine(data, "sweet");
  nextEngine.state.currentTimeMinutes = firstBounds.end + 180;
  nextEngine.state.stageTransitionPending = true;
  const overrun = await nextEngine.confirmStageTransition();
  assert.equal(overrun.stageId, "stage-02");
  assert.equal(nextEngine.state.currentTimeMinutes, firstBounds.end + 180);
});

test("selects available events by priority and supports repeat and once policies", async () => {
  const data = await loadGameDataFixture();
  const events = data["data/events.yaml"].events;
  events[0].relatedEndingIds = [];
  events[1].relatedEndingIds = [];
  events[0].priority = 10;
  events[1].priority = 25;
  events[0].repeatPolicy.mode = "repeat";
  const engine = new GameEngine(data, "sweet", { random: () => 0 });
  engine.state.storyFlags.sample_event_unlocked = true;
  engine.state.storyFlags.sample_event_seen = true;

  assert.equal(engine.getAvailableEvents()[0].id, "sample-follow-up");
  events[0].relatedEndingIds = ["completion", "abandonment"];
  events[1].priority = 15;
  assert.equal(engine.getAvailableEvents()[0].id, "sample-arrival");
  const started = engine.startEvent("sample-arrival");
  assert.equal(started.timeAdvanced, false);
  const choice = engine.chooseEventOption("continue");
  assert.equal(choice.nextEventId, "sample-follow-up");
  assert.equal(engine.state.choiceHistory.length, 1);
  assert.ok(engine.getAvailableEvents().some(({ id }) => id === "sample-arrival"));

  events[0].repeatPolicy.mode = "once";
  assert.ok(!engine.getAvailableEvents().some(({ id }) => id === "sample-arrival"));
});

test("event selection observes probability and starts the chosen event once", async () => {
  const data = await loadGameDataFixture();
  const events = data["data/events.yaml"].events;
  events[0].priority = 100;
  events[0].probability = 0;
  events[0].relatedEndingIds = [];
  events[1].priority = 50;
  events[1].probability = 0.5;
  events[1].relatedEndingIds = [];
  const randomValues = [0.25, 0.49];
  const engine = new GameEngine(data, "sweet", {
    random: () => randomValues.shift() ?? 0,
  });
  engine.state.storyFlags.sample_event_unlocked = true;
  engine.state.storyFlags.sample_event_seen = true;
  const before = engine.state.currentTimeMinutes;

  const selected = engine.selectNextEvent();

  assert.equal(selected.id, "sample-follow-up");
  assert.equal(engine.state.activeEventId, "sample-follow-up");
  assert.equal(engine.state.currentTimeMinutes, before);
});

test("rechecks deferred event conditions before presenting them again", async () => {
  const data = await loadGameDataFixture();
  const engine = new GameEngine(data, "sweet", { random: () => 0 });
  engine.state.storyFlags.sample_event_unlocked = true;
  engine.startEvent("sample-arrival");

  const deferred = engine.deferEvent();
  assert.equal(deferred.timeAdvanced, false);
  assert.equal(engine.state.pendingEvents.length, 1);
  engine.state.storyFlags.sample_event_unlocked = false;
  assert.ok(!engine.getAvailableEvents().some(({ id }) => id === "sample-arrival"));
  engine.state.storyFlags.sample_event_unlocked = true;
  assert.ok(engine.getAvailableEvents().some(({ id }) => id === "sample-arrival"));
});

test("enforces cooldowns across stages and applies event-choice branches", async () => {
  const data = await loadGameDataFixture();
  const event = data["data/events.yaml"].events[1];
  event.stageId = "stage-03";
  const engine = new GameEngine(data, "sweet", { random: () => 0 });
  engine.state.currentStageIndex = 2;
  engine.state.currentStageId = "stage-03";
  engine.state.storyFlags.sample_event_seen = true;
  engine.state.eventHistory.push({
    eventId: event.id,
    status: "completed",
    stageNumber: 2,
  });

  assert.ok(!engine.getAvailableEvents().some(({ id }) => id === event.id));
  engine.state.eventHistory[0].stageNumber = 1;
  assert.ok(engine.getAvailableEvents().some(({ id }) => id === event.id));

  const dataWithChoice = await loadGameDataFixture();
  const branchEngine = new GameEngine(dataWithChoice, "sweet", { random: () => 0 });
  branchEngine.state.storyFlags.sample_event_unlocked = true;
  const before = branchEngine.state.currentTimeMinutes;
  branchEngine.startEvent("sample-arrival");
  const result = branchEngine.chooseEventOption("continue");
  assert.equal(result.nextEventId, "sample-follow-up");
  assert.equal(branchEngine.state.currentTimeMinutes, before);
});

test("supports immediate abandonment and final-stage completion endings", async () => {
  const abandonmentData = await loadGameDataFixture();
  const abandonmentEngine = new GameEngine(abandonmentData, "sweet", { random: () => 0 });
  abandonmentEngine.state.storyFlags.sample_event_unlocked = true;
  abandonmentEngine.startEvent("sample-arrival");
  const abandonmentResult = abandonmentEngine.chooseEventOption("leave-early");
  assert.equal(abandonmentResult.ending.endingId, "abandonment");
  assert.equal(abandonmentEngine.state.endingReached, true);

  const completionData = await loadGameDataFixture();
  const completionEngine = new GameEngine(completionData, "sweet");
  const lastStageIndex = completionData["data/stages.yaml"].stages.length - 1;
  completionEngine.state.currentStageIndex = lastStageIndex;
  completionEngine.state.currentStageId =
    completionData["data/stages.yaml"].stages[lastStageIndex].id;
  const bounds = getStageBounds(
    completionData,
    completionData["data/stages.yaml"].stages[lastStageIndex],
  );
  completionEngine.state.currentTimeMinutes = bounds.end - 30;

  const actionResult = await completionEngine.performAction("conversation");
  assert.equal(actionResult.stageTransitionPending, true);
  assert.equal(actionResult.ending, null);
  const completionResult = await completionEngine.confirmStageTransition();
  assert.equal(completionResult.ending.endingId, "completion");
  assert.equal(completionResult.resultReady, true);
});
