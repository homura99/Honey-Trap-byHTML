import { getDisplayStamina } from "../game/effects.js";
import { GameEngine } from "../game/engine.js";
import {
  createAutoSaveHandler,
  SAVE_SLOTS,
} from "../storage/indexeddb-save-repository.js";
import {
  PresentationController,
  resolveDisplayMode,
  resolvePresentation,
} from "./presentation.js";
import { renderApp } from "./views.js";

const SAVE_SLOT_IDS = [...SAVE_SLOTS.manual, SAVE_SLOTS.auto];
const INTERACTIVE_SELECTOR = "button, a, input, select, textarea, [contenteditable='true']";

export class GameApp {
  constructor(root, gameData, repository) {
    this.root = root;
    this.gameData = gameData;
    this.repository = repository;
    this.screen = "home";
    this.saveMode = "load";
    this.engine = null;
    this.currentEvent = null;
    this.dialogueIndex = 0;
    this.dialogueFinished = false;
    this.displayModeOverride = null;
    this.slots = [];
    this.endings = [];
    this.endingRate = { collected: 0, total: 0, rate: 0 };
    this.message = null;
    this.resultTitle = "";
    this.resultMessage = "";
    this.resultDialogue = [];
    this.busy = false;
    this.recordedEndingIds = new Set();
    this.presentationController = new PresentationController();
    this.handleClick = this.handleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  mount() {
    this.root.addEventListener("click", this.handleClick);
    this.root.ownerDocument.addEventListener("keydown", this.handleKeyDown);
    this.render();
    void this.refreshSlots();
    void this.refreshEndings();
  }

  get stageTitles() {
    return Object.fromEntries(
      this.gameData["data/stages.yaml"].stages.map((stage) => [stage.id, stage.title]),
    );
  }

  getViewModel() {
    const state = this.engine?.state;
    const stage = state
      ? this.gameData["data/stages.yaml"].stages[state.currentStageIndex]
      : null;
    const difficulty = state
      ? this.gameData["data/settings.yaml"].difficulty[state.difficultyId]
      : null;
    const staminaDefinition = this.gameData["data/settings.yaml"].parameters.stamina;
    const actions = state
      ? this.gameData["data/actions.yaml"].actions.map((action) => ({
        ...action,
        staminaCost: action.staminaCost * difficulty.staminaCostMultiplier,
      }))
      : [];
    const eventLines = this.currentEvent?.dialogue ?? [];

    const autoSlot = this.slots.find((slot) => slot.slotId === SAVE_SLOTS.auto);

    return {
      screen: this.screen,
      message: this.message,
      engine: this.engine,
      autoSaveAvailable: Boolean(autoSlot?.occupied && !autoSlot.corrupted),
      saveMode: this.saveMode,
      slots: SAVE_SLOT_IDS.map((slotId) =>
        this.slots.find((slot) => slot.slotId === slotId) ?? {
          slotId,
          type: slotId === SAVE_SLOTS.auto ? "auto" : "manual",
          occupied: false,
          savedAt: null,
          progress: null,
        }),
      stageTitles: this.stageTitles,
      canSave: Boolean(this.engine?.canSave) && !this.busy,
      stageNumber: stage?.number ?? 0,
      stageTitle: stage?.title ?? "",
      time: this.engine?.getTime() ?? { period: "", time: "", date: "" },
      displayStamina: state ? getDisplayStamina(this.gameData, state) : 0,
      maxStamina: staminaDefinition.max,
      affection: state?.affection ?? 0,
      subscribers: state?.subscribers ?? 0,
      difficultyLabel: difficulty?.label ?? "",
      storyFlagSummary: state ? JSON.stringify(state.storyFlags) || "なし" : "なし",
      eventHistoryCount: state?.eventHistory.length ?? 0,
      pendingEventCount: state?.pendingEvents.length ?? 0,
      stageTransitionPending: Boolean(state?.stageTransitionPending),
      actions,
      event: this.currentEvent,
      eventLine: eventLines[this.dialogueIndex],
      displayMode: resolveDisplayMode(
        eventLines[this.dialogueIndex],
        this.displayModeOverride,
      ),
      presentation: resolvePresentation(eventLines[this.dialogueIndex]),
      presentationCueId: this.currentEvent
        ? `${this.currentEvent.id}:${this.dialogueIndex}`
        : "no-event",
      eventChoices: this.dialogueFinished ? this.currentEvent?.choices ?? [] : [],
      dialogueFinished: this.dialogueFinished,
      endings: this.endings,
      endingRate: this.endingRate,
      resultTitle: this.resultTitle,
      resultMessage: this.resultMessage,
      resultDialogue: this.resultDialogue,
    };
  }

  render() {
    const view = this.getViewModel();
    this.presentationController.update(
      this.root,
      view.presentation ?? resolvePresentation(null),
      view.presentationCueId,
    );
    this.root.innerHTML = renderApp(view);
  }

  showMessage(text, type = "status") {
    this.message = { text, type };
    this.render();
  }

  clearMessage() {
    this.message = null;
  }

  async refreshSlots() {
    try {
      this.slots = await this.repository.listSlots();
      this.render();
    } catch (error) {
      this.showMessage(`セーブ枠を取得できませんでした: ${this.errorMessage(error)}`, "error");
    }
  }

  async refreshEndings() {
    try {
      const { endingIds } = await this.repository.getEndingCollection();
      this.endingRate = await this.repository.getEndingCompletionRate();
      this.endings = this.gameData["data/endings/index.yaml"].endings.map((ending) => ({
        ...ending,
        collected: endingIds.includes(ending.id),
      }));
      this.render();
    } catch (error) {
      this.showMessage(`エンディング記録を取得できませんでした: ${this.errorMessage(error)}`, "error");
    }
  }

  errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  makeEngine(difficultyId) {
    return new GameEngine(this.gameData, difficultyId, {
      autoSave: createAutoSaveHandler(this.repository),
    });
  }

  async openGame(difficultyId) {
    this.engine = this.makeEngine(difficultyId);
    this.currentEvent = null;
    this.dialogueIndex = 0;
    this.dialogueFinished = false;
    this.displayModeOverride = null;
    this.screen = "game";
    this.clearMessage();
    this.render();
  }

  async loadSlot(slotId, confirmReplace = true) {
    if (confirmReplace && this.engine && this.screen !== "home" && this.screen !== "result") {
      const accepted = this.root.ownerDocument.defaultView.confirm(
        "現在のゲームを保存データで置き換えますか？",
      );
      if (!accepted) {
        return;
      }
    }

    const previousScreen = this.screen;
    this.screen = "loading";
    this.render();
    try {
      const engine = this.makeEngine("sweet");
      const loaded = await this.repository.load(engine, slotId);
      if (!loaded) {
        this.screen = previousScreen;
        this.showMessage("このセーブ枠にはデータがありません。", "error");
        return;
      }
      this.engine = engine;
      this.currentEvent = null;
      this.dialogueIndex = 0;
      this.dialogueFinished = false;
      this.displayModeOverride = null;
      this.screen = "game";
      this.clearMessage();
      await this.refreshSlots();
      if (engine.state.endingReached) {
        await this.showEnding(engine.state.endingId);
        return;
      }
      this.showMessage(`${slotId} をロードしました。`);
    } catch (error) {
      this.screen = previousScreen;
      this.showMessage(`ロードに失敗しました: ${this.errorMessage(error)}`, "error");
    }
  }

  async handleClick(event) {
    const target = event.target instanceof Element
      ? event.target.closest("[data-action]")
      : null;
    if (!target || target.hasAttribute("disabled") || this.busy) {
      return;
    }
    event.preventDefault();
    const action = target.dataset.action;
    const value = target.dataset.value;

    try {
      switch (action) {
        case "home":
          this.screen = "home";
          this.clearMessage();
          this.render();
          break;
        case "new-game":
          this.screen = "config";
          this.clearMessage();
          this.render();
          break;
        case "start-game":
          await this.openGame(value);
          break;
        case "continue":
          await this.loadSlot(SAVE_SLOTS.auto, false);
          break;
        case "game":
          this.screen = "game";
          this.clearMessage();
          this.render();
          break;
        case "menu":
          this.screen = "menu";
          this.render();
          break;
        case "settings":
          this.screen = "settings";
          this.render();
          break;
        case "endings":
          this.screen = "endings";
          await this.refreshEndings();
          break;
        case "save-screen":
          this.saveMode = "save";
          this.screen = "save";
          await this.refreshSlots();
          break;
        case "load-screen":
          this.saveMode = "load";
          this.screen = "load";
          await this.refreshSlots();
          break;
        case "save-slot":
          await this.saveSlot(value);
          break;
        case "load-slot":
          await this.loadSlot(value);
          break;
        case "export-slot":
          await this.exportSlot(value);
          break;
        case "perform-action":
          await this.performAction(value);
          break;
        case "check-event":
          this.presentNextEvent();
          break;
        case "unlock-sample-event":
          this.unlockSampleEvent();
          break;
        case "advance-dialogue":
          this.advanceDialogue();
          break;
        case "toggle-display-mode":
          this.toggleDisplayMode();
          break;
        case "choose-event":
          this.chooseEvent(value);
          break;
        case "complete-event":
          this.completeEvent();
          break;
        case "defer-event":
          this.deferEvent();
          break;
        case "confirm-stage":
          await this.confirmStageTransition();
          break;
        default:
          break;
      }
    } catch (error) {
      this.showMessage(this.errorMessage(error), "error");
    }
  }

  handleKeyDown(event) {
    if (event.key === "Escape") {
      if (this.screen === "menu") {
        this.screen = "game";
      } else if (this.screen === "game" && this.engine) {
        this.screen = "menu";
      } else {
        return;
      }
      event.preventDefault();
      this.render();
      return;
    }

    if (!this.currentEvent || !["Enter", " "].includes(event.key)) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) {
      return;
    }
    event.preventDefault();
    this.advanceDialogue();
  }

  async saveSlot(slotId) {
    const slot = this.slots.find((entry) => entry.slotId === slotId);
    if (!this.engine?.canSave) {
      this.showMessage("現在は安全に手動セーブできません。", "error");
      return;
    }
    if (slot?.occupied && !this.root.ownerDocument.defaultView.confirm(
      "このセーブ枠を上書きしますか？",
    )) {
      return;
    }
    try {
      await this.repository.saveManual(this.engine, slotId);
      await this.refreshSlots();
      this.showMessage("セーブしました。");
    } catch (error) {
      this.showMessage(`セーブに失敗しました: ${this.errorMessage(error)}`, "error");
    }
  }

  async exportSlot(slotId) {
    try {
      const json = await this.repository.exportSlotJson(slotId);
      const document = this.root.ownerDocument;
      const URLApi = document.defaultView.URL;
      const blobUrl = URLApi.createObjectURL(new Blob([json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `honey-trap-${slotId}.json`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      document.defaultView.setTimeout(() => URLApi.revokeObjectURL(blobUrl), 0);
      this.showMessage("JSONファイルをダウンロードしました。");
    } catch (error) {
      this.showMessage(`JSONエクスポートに失敗しました: ${this.errorMessage(error)}`, "error");
    }
  }

  async performAction(actionId) {
    if (!this.engine) {
      return;
    }
    this.busy = true;
    this.render();
    try {
      const result = await this.engine.performAction(actionId);
      this.busy = false;
      if (result.autoSave?.success === false) {
        this.showMessage(`行動しましたが、オートセーブに失敗しました: ${result.autoSave.error}`, "error");
      } else {
        const action = this.gameData["data/actions.yaml"].actions.find(({ id }) => id === actionId);
        this.showMessage(`${action.label}を実行しました。`);
      }
      if (this.engine.state.endingReached) {
        await this.showEnding(this.engine.state.endingId);
        return;
      }
      if (!this.engine.state.stageTransitionPending) {
        this.presentNextEvent();
      } else {
        this.render();
      }
    } catch (error) {
      this.busy = false;
      this.showMessage(`行動を実行できませんでした: ${this.errorMessage(error)}`, "error");
    }
  }

  presentNextEvent() {
    if (!this.engine || this.engine.state.stageTransitionPending) {
      return;
    }
    try {
      const event = this.engine.selectNextEvent();
      if (event) {
        this.currentEvent = event;
        this.dialogueIndex = 0;
        this.dialogueFinished = event.dialogue.length === 0;
        this.displayModeOverride = null;
        this.screen = "game";
        this.clearMessage();
      } else {
        if (this.message?.type !== "error") {
          this.showMessage("現在、発生可能なイベントはありません。");
        }
        return;
      }
      this.render();
    } catch (error) {
      this.showMessage(`イベントを開始できませんでした: ${this.errorMessage(error)}`, "error");
    }
  }

  unlockSampleEvent() {
    if (!this.engine || this.engine.state.endingReached) {
      return;
    }
    this.engine.state.storyFlags.sample_event_unlocked = true;
    this.presentNextEvent();
  }

  advanceDialogue() {
    if (!this.currentEvent) {
      return;
    }
    if (this.dialogueIndex + 1 < this.currentEvent.dialogue.length) {
      this.dialogueIndex += 1;
      this.displayModeOverride = null;
    } else {
      this.dialogueFinished = true;
    }
    this.render();
  }

  toggleDisplayMode() {
    if (!this.currentEvent) {
      return;
    }
    const currentMode = resolveDisplayMode(
      this.currentEvent.dialogue[this.dialogueIndex],
      this.displayModeOverride,
    );
    this.displayModeOverride = currentMode === "bottom" ? "fullscreen" : "bottom";
    this.render();
  }

  chooseEvent(choiceId) {
    if (!this.engine || !this.currentEvent || !this.dialogueFinished) {
      return;
    }
    const result = this.engine.chooseEventOption(choiceId);
    this.currentEvent = null;
    this.dialogueFinished = false;
    this.displayModeOverride = null;
    if (this.engine.state.endingReached) {
      void this.showEnding(this.engine.state.endingId);
      return;
    }
    if (result.nextEventId) {
      this.currentEvent = this.engine.startEvent(result.nextEventId);
      if (this.currentEvent) {
        this.dialogueIndex = 0;
        this.dialogueFinished = this.currentEvent.dialogue.length === 0;
        this.displayModeOverride = null;
      }
    }
    this.showMessage("選択を反映しました。");
    this.render();
  }

  completeEvent() {
    if (!this.engine || !this.currentEvent) {
      return;
    }
    this.engine.completeEvent();
    this.currentEvent = null;
    this.dialogueFinished = false;
    this.displayModeOverride = null;
    if (this.engine.state.endingReached) {
      void this.showEnding(this.engine.state.endingId);
    } else {
      this.showMessage("イベントを終了しました。");
    }
  }

  deferEvent() {
    if (!this.engine || !this.currentEvent) {
      return;
    }
    this.engine.deferEvent();
    this.currentEvent = null;
    this.dialogueFinished = false;
    this.displayModeOverride = null;
    this.showMessage("イベントを後回しにしました。");
  }

  async confirmStageTransition() {
    if (!this.engine) {
      return;
    }
    this.busy = true;
    this.render();
    try {
      const result = await this.engine.confirmStageTransition();
      this.busy = false;
      if (this.engine.state.endingReached) {
        await this.showEnding(this.engine.state.endingId);
        return;
      }
      if (this.engine.state.campaignComplete) {
        this.resultTitle = "ゲーム完了";
        this.resultMessage = "全ステージを終了しました。";
        this.resultDialogue = [];
        this.screen = "result";
        this.render();
        return;
      }
      if (result.autoSave?.success === false) {
        this.showMessage(`ステージを移行しましたが、オートセーブに失敗しました: ${result.autoSave.error}`, "error");
      } else {
        this.showMessage("次のステージへ移行しました。");
      }
      this.presentNextEvent();
    } catch (error) {
      this.busy = false;
      this.showMessage(`ステージを移行できませんでした: ${this.errorMessage(error)}`, "error");
    }
  }

  async showEnding(endingId) {
    const ending = this.gameData["data/endings/index.yaml"].endings.find(
      (entry) => entry.id === endingId,
    );
    if (!ending) {
      this.showMessage(`エンディング "${endingId}" が見つかりません。`, "error");
      return;
    }
    this.resultTitle = ending.title;
    this.resultMessage = "エンディングに到達しました。回収記録はセーブ枠共通です。";
    this.resultDialogue = this.gameData.endingScenarios[ending.scenario]?.dialogue ?? [];
    this.currentEvent = null;
    this.displayModeOverride = null;
    this.screen = "result";
    if (!this.recordedEndingIds.has(endingId)) {
      try {
        await this.repository.addCollectedEnding(endingId);
        this.recordedEndingIds.add(endingId);
        await this.refreshEndings();
      } catch (error) {
        this.showMessage(`結果を表示しましたが、回収記録の保存に失敗しました: ${this.errorMessage(error)}`, "error");
      }
    }
    this.render();
  }
}
