import assert from "node:assert/strict";
import test from "node:test";
import {
  PresentationController,
  renderScenePresentation,
  resolveDisplayMode,
  resolvePresentation,
} from "../src/ui/presentation.js";
import { renderApp } from "../src/ui/views.js";

const baseView = {
  screen: "home",
  message: null,
  engine: null,
  autoSaveAvailable: false,
  saveMode: "load",
  slots: [],
  stageTitles: {},
  canSave: false,
  stageNumber: 1,
  stageTitle: "仮ステージ 01",
  time: { period: "朝", time: "08:00", date: "2025-04-01" },
  displayStamina: 100,
  maxStamina: 100,
  affectionMin: 0,
  affectionMax: 100,
  affection: 10,
  subscribers: 1,
  difficultyLabel: "甘口",
  storyFlagSummary: "なし",
  eventHistoryCount: 0,
  pendingEventCount: 0,
  stageTransitionPending: false,
  canPerformActions: false,
  actionsPanelOpen: false,
  actions: [],
  backlog: [],
  autoPlayEnabled: false,
  skipReadEnabled: false,
  event: null,
  eventLine: null,
  eventChoices: [],
  dialogueFinished: false,
  displayMode: "bottom",
  endings: [],
  endingRate: { collected: 0, total: 0, rate: 0 },
  resultTitle: "",
  resultMessage: "",
  resultDialogue: [],
};

test("renders home navigation, new-game entry, and disabled continue without an auto-save", () => {
  const html = renderApp(baseView);

  assert.match(html, /data-action="new-game"/);
  assert.match(html, /data-action="continue" disabled/);
  assert.match(html, /data-action="load-screen"/);
  assert.match(html, /data-action="endings"/);
});

test("renders a dedicated loading state for save restoration", () => {
  const html = renderApp({ ...baseView, screen: "loading" });

  assert.match(html, /LOADING/);
  assert.match(html, /ロードしています/);
  assert.match(html, /aria-busy="true"/);
});

test("renders cloud save import and Google account linking controls", () => {
  const loadHtml = renderApp({ ...baseView, screen: "load" });
  const settingsHtml = renderApp({
    ...baseView,
    screen: "settings",
    authStatus: "ゲスト利用中",
    googleLinked: false,
  });

  assert.match(loadHtml, /エクスポート済みJSONをクラウドへ取り込む/);
  assert.match(loadHtml, /type="file" accept="application\/json,\.json"/);
  assert.match(settingsHtml, /Googleアカウントを連携/);
  assert.match(settingsHtml, /認証情報はWebhookへ送信しません/);
});

test("renders YAML-driven event dialogue and choices with escaped text", () => {
  const html = renderApp({
    ...baseView,
    screen: "game",
    engine: {},
    event: {
      dialogue: [{ speaker: "<speaker>", text: "<script>alert(1)</script>" }],
      choices: [{ id: "route", text: "選択する" }],
      deferPolicy: { enabled: true },
    },
    eventLine: { speaker: "<speaker>", text: "<script>alert(1)</script>" },
    eventChoices: [{ id: "route", text: "選択する" }],
    dialogueFinished: true,
  });

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /data-action="choose-event" data-value="route"/);
  assert.match(html, /data-action="defer-event"/);
  assert.match(html, /<div class="scene-background" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(html, /character-placeholder|キャラクター画像/);
  assert.doesNotMatch(html, /背景画像プレースホルダー/);
});

test("supports unnamed narration and optional local background and silhouette assets", () => {
  const narrationView = {
    ...baseView,
    screen: "game",
    engine: {},
    event: {
      id: "narration-sample",
      dialogue: [{ type: "narration", text: "名前のない地の文です。" }],
      choices: [],
      deferPolicy: { enabled: false },
    },
    eventLine: { type: "narration", text: "名前のない地の文です。" },
    eventChoices: [],
    dialogueFinished: false,
    presentation: resolvePresentation({
      backgroundImage: "/images/night.png",
      silhouetteImage: "/images/person-shadow.png",
    }),
  };
  const html = renderApp(narrationView);

  assert.match(html, /名前のない地の文です。/);
  assert.match(html, /aria-label="イベント地の文"/);
  assert.doesNotMatch(html, /<span class="speaker">/);
  assert.match(html, /class="scene-background-image" src="\/images\/night\.png"/);
  assert.match(html, /class="scene-silhouette"/);
  assert.match(html, /<img src="\/images\/person-shadow\.png"/);
  assert.doesNotMatch(html, /キャラクター画像/);
});

test("renders compact stage parameters while keeping action choices closed during dialogue", () => {
  const html = renderApp({
    ...baseView,
    screen: "game",
    engine: {},
    event: {
      id: "scene",
      dialogue: [{ speaker: "わな", text: "物語の文章です。" }],
      choices: [],
      deferPolicy: { enabled: false },
    },
    eventLine: { speaker: "わな", text: "物語の文章です。" },
    eventChoices: [],
  });

  assert.match(html, /class="scene" aria-label="サウンドノベル画面"/);
  assert.match(html, /data-action="backlog"/);
  assert.match(html, /data-action="menu"/);
  assert.match(html, /class="scene-parameters" aria-label="現在のパラメータ"/);
  assert.match(html, /aria-label="スタミナ"/);
  assert.match(html, /aria-label="好感度"/);
  assert.match(html, /登録者数/);
  assert.doesNotMatch(html, /scene-action-panel/);
  assert.doesNotMatch(html, /仮イベント解放/);
  assert.match(html, /物語の文章です。/);
  assert.doesNotMatch(html, /scene-status|sidebar/);
});

test("keeps the development-only sample event control in the auxiliary menu", () => {
  const html = renderApp({ ...baseView, screen: "menu", engine: {} });

  assert.match(html, /data-action="unlock-sample-event"/);
});

test("renders a dedicated action menu with engine previews and an on-demand status page", () => {
  const actionHtml = renderApp({
    ...baseView,
    screen: "actions",
    engine: {},
    canPerformActions: true,
    actions: [{
      id: "conversation",
      label: "会話",
      description: "わなと話す。",
      timeCostMinutes: 30,
      preview: {
        timeCostMinutes: 30,
        staminaCost: 5,
        parameterChanges: { affection: 2, stamina: -5, subscribers: 0 },
      },
    }],
  });
  const statusHtml = renderApp({ ...baseView, screen: "status", engine: {} });

  assert.match(actionHtml, /わなと話す。/);
  assert.match(actionHtml, /消費スタミナ/);
  assert.match(actionHtml, /好感度 \+2/);
  assert.match(actionHtml, /実行可能/);
  assert.match(statusHtml, /現在時刻/);
  assert.match(statusHtml, /登録者数/);
});

test("renders in-game action choices with engine-derived changes on hover or focus", () => {
  const html = renderApp({
    ...baseView,
    screen: "game",
    engine: {},
    canPerformActions: true,
    actionsPanelOpen: true,
    actions: [{
      id: "conversation",
      label: "会話",
      description: "わなと話す。",
      timeCostMinutes: 30,
      preview: {
        timeCostMinutes: 30,
        staminaCost: 5,
        parameterChanges: { affection: 2, stamina: -5, subscribers: 0 },
      },
    }],
  });

  assert.match(html, /class="scene-action-panel" aria-label="行動選択肢"/);
  assert.match(html, /data-action="perform-action" data-value="conversation"/);
  assert.match(html, /好感度 \+2 \/ スタミナ -5/);
  assert.ok(html.indexOf("class=\"scene-action-preview\"") < html.indexOf("data-action=\"perform-action\""));
});

test("supports multiple CSS silhouette placeholders with bounded layout values", () => {
  const presentation = resolvePresentation({
    scene: "studio-dusk",
    silhouettes: [
      { placeholder: true, left: 20, bottom: 8, width: 30, opacity: 75, brightness: 35 },
      { image: "/images/person.png", left: 60, width: 25 },
    ],
  });
  const html = renderScenePresentation(presentation);

  assert.equal(presentation.silhouettes.length, 2);
  assert.match(html, /scene-background--studio-dusk/);
  assert.match(html, /scene-silhouette--placeholder/);
  assert.match(html, /--silhouette-left:20%/);
  assert.match(html, /<img src="\/images\/person\.png"/);
});

test("uses bottom mode by default and renders a fullscreen event line with a mode toggle", () => {
  const defaultHtml = renderApp({
    ...baseView,
    screen: "game",
    engine: {},
    event: {
      id: "mode-sample",
      dialogue: [{ text: "通常表示の文章です。" }],
      choices: [],
      deferPolicy: { enabled: false },
    },
    eventLine: { text: "通常表示の文章です。" },
    eventChoices: [],
  });
  const fullscreenHtml = renderApp({
    ...baseView,
    screen: "game",
    engine: {},
    event: {
      id: "mode-sample",
      dialogue: [{ displayMode: "fullscreen", text: "全画面の文章です。" }],
      choices: [],
      deferPolicy: { enabled: false },
    },
    eventLine: { displayMode: "fullscreen", text: "全画面の文章です。" },
    displayMode: "fullscreen",
    eventChoices: [],
  });

  assert.equal(resolveDisplayMode({ text: "legacy" }), "bottom");
  assert.equal(resolveDisplayMode({ displayMode: "fullscreen" }), "fullscreen");
  assert.equal(resolveDisplayMode({ displayMode: "fullscreen" }, "bottom"), "bottom");
  assert.match(defaultHtml, /dialogue-window--bottom/);
  assert.match(defaultHtml, /全画面表示に切り替え/);
  assert.match(fullscreenHtml, /dialogue-window--fullscreen/);
  assert.match(fullscreenHtml, /通常表示に切り替え/);
  assert.match(fullscreenHtml, /全画面の文章です。/);
});

test("rejects remote presentation assets and carries audio cues outside text rendering", () => {
  const presentation = resolvePresentation({
    backgroundImage: "https://example.invalid/background.png",
    silhouetteImage: "javascript:alert(1)",
    bgm: "quiet-theme",
    soundEffects: ["page-turn", 1],
  });
  const html = renderScenePresentation(presentation);

  assert.equal(presentation.backgroundImage, null);
  assert.equal(presentation.silhouetteImage, null);
  assert.equal(presentation.bgm, "quiet-theme");
  assert.deepEqual(presentation.soundEffects, ["page-turn"]);
  assert.doesNotMatch(html, /scene-silhouette|<img/);
});

test("emits sound presentation cues independently and once per dialogue line", () => {
  const emitted = [];
  class TestCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const root = {
    ownerDocument: { defaultView: { CustomEvent: TestCustomEvent } },
    dispatchEvent(event) {
      emitted.push(event);
    },
  };
  const controller = new PresentationController();
  const presentation = resolvePresentation({
    bgm: "quiet-theme",
    soundEffects: ["page-turn"],
  });

  controller.update(root, presentation, "event-1:0");
  controller.update(root, presentation, "event-1:0");
  controller.update(root, presentation, "event-1:1");

  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].type, "game:presentation");
  assert.deepEqual(emitted[1].detail, {
    bgm: "quiet-theme",
    soundEffects: ["page-turn"],
  });
});

test("hides uncollected ending titles and exposes the collection rate", () => {
  const html = renderApp({
    ...baseView,
    screen: "endings",
    endings: [
      { id: "secret", title: "ネタバレのある題名", collected: false },
      { id: "found", title: "回収済みの題名", collected: true },
    ],
    endingRate: { collected: 1, total: 2, rate: 0.5 },
  });

  assert.doesNotMatch(html, /ネタバレのある題名/);
  assert.match(html, /？？？/);
  assert.match(html, /回収済みの題名/);
  assert.match(html, /回収率 1 \/ 2/);
});

test("shows transition confirmation and surfaces failures as alerts", () => {
  const html = renderApp({
    ...baseView,
    screen: "game",
    engine: {},
    stageTransitionPending: true,
    message: { type: "error", text: "保存に失敗しました" },
  });

  assert.match(html, /role="dialog" aria-labelledby="stage-confirm-title"/);
  assert.match(html, /data-action="confirm-stage"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /保存に失敗しました/);
  assert.doesNotMatch(html, /data-action="perform-action"/);
});
