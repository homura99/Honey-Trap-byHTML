import { renderScenePresentation } from "./presentation.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function button(label, action, options = {}) {
  const disabled = options.disabled ? " disabled" : "";
  const kind = options.kind ? ` button--${escapeHtml(options.kind)}` : "";
  const value = options.value ? ` data-value="${escapeHtml(options.value)}"` : "";
  return `<button class="button${kind}" type="button" data-action="${escapeHtml(action)}"${value}${disabled}>${escapeHtml(label)}</button>`;
}

function navigation(gameActive) {
  return `
    <nav class="top-nav" aria-label="メニュー">
      ${button("ホーム", "home", { kind: "quiet" })}
      ${gameActive ? button("セーブ", "save-screen", { kind: "quiet" }) : ""}
      ${button("ロード", "load-screen", { kind: "quiet" })}
      ${button("設定", "settings", { kind: "quiet" })}
      ${button("エンディング", "endings", { kind: "quiet" })}
    </nav>
  `;
}

function home(view) {
  return `
    <section class="home-screen panel">
      <p class="eyebrow">DEVELOPMENT BUILD / 仮画面</p>
      <h1>天依わな育成シミュレーション</h1>
      <p class="muted">画面・シナリオ・数値は開発用の仮データです。</p>
      <div class="home-actions">
        ${button("はじめから", "new-game", { kind: "primary" })}
        ${button("つづきから", "continue", {
          disabled: !view.autoSaveAvailable,
        })}
        ${button("ロード", "load-screen")}
        ${button("設定", "settings")}
        ${button("エンディング一覧", "endings")}
      </div>
      <p class="muted small">サウンドノベル形式の仮画面です。背景素材未設定時は単色表示になります。</p>
    </section>
  `;
}

function config() {
  return `
    <section class="panel narrow-panel">
      <p class="eyebrow">NEW GAME</p>
      <h1>難易度を選択</h1>
      <p class="muted">難易度はゲーム開始後に変更できません。</p>
      <div class="stack">
        ${button("甘口", "start-game", { value: "sweet", kind: "primary" })}
        ${button("辛口", "start-game", { value: "spicy" })}
        ${button("戻る", "home", { kind: "quiet" })}
      </div>
    </section>
  `;
}

function statusDetails(view) {
  return `
    <details class="details-panel">
      <summary>詳細ステータス</summary>
      <dl class="detail-grid">
        <dt>好感度</dt><dd>${escapeHtml(view.affection)}</dd>
        <dt>登録者数</dt><dd>${escapeHtml(view.subscribers)}</dd>
        <dt>難易度</dt><dd>${escapeHtml(view.difficultyLabel)}</dd>
        <dt>ストーリーフラグ</dt><dd>${escapeHtml(view.storyFlagSummary)}</dd>
        <dt>イベント履歴</dt><dd>${escapeHtml(view.eventHistoryCount)} 件</dd>
        <dt>保留イベント</dt><dd>${escapeHtml(view.pendingEventCount)} 件</dd>
      </dl>
    </details>
  `;
}

function dialogue(view) {
  if (!view.event) {
    return `
      <section class="dialogue-window narration-window" aria-label="地の文">
        <p>行動を選ぶか、発生可能なイベントを確認してください。</p>
        <span class="dialogue-hint">イベント会話中は Enter / Space でも進めます。</span>
      </section>
    `;
  }

  const line = view.eventLine;
  const displayMode = view.displayMode ?? "bottom";
  const isNarration = line?.type === "narration" || line?.speaker === "ナレーション" ||
    typeof line?.speaker !== "string" || !line.speaker.trim();
  const eventControls = view.eventChoices.length > 0
    ? `<div class="choice-list" aria-label="選択肢">
        ${view.eventChoices.map((choice) =>
    button(choice.text, "choose-event", { value: choice.id }),
  ).join("")}
      </div>`
    : view.dialogueFinished
      ? button("会話を閉じる", "complete-event", { kind: "primary" })
      : button("会話送り", "advance-dialogue", { kind: "primary" });

  return `
    <section class="dialogue-window dialogue-window--${escapeHtml(displayMode)}${isNarration ? " narration-window" : ""}" aria-label="${isNarration ? "イベント地の文" : "イベント会話"}">
      ${isNarration ? "" : `<span class="speaker">${escapeHtml(line.speaker)}</span>`}
      <p>${escapeHtml(line?.text ?? "（会話データがありません）")}</p>
      <span class="dialogue-hint">${view.dialogueFinished ? "選択してください" : "Enter / Space またはボタンで会話送り"}</span>
      ${button(
    displayMode === "bottom" ? "全画面表示に切り替え" : "通常表示に切り替え",
    "toggle-display-mode",
    { kind: "quiet" },
  )}
      ${eventControls}
      ${view.event.deferPolicy.enabled
    ? button("後回し", "defer-event", { kind: "quiet" })
    : ""}
    </section>
  `;
}

function resultText(line) {
  const isNarration = line.type === "narration" || line.speaker === "ナレーション" ||
    typeof line.speaker !== "string" || !line.speaker.trim();
  return `
    <blockquote class="${isNarration ? "narration-line" : ""}">
      ${isNarration ? "" : `<strong>${escapeHtml(line.speaker)}</strong>`}
      <p>${escapeHtml(line.text)}</p>
    </blockquote>
  `;
}

function actionList(view) {
  if (view.event || view.stageTransitionPending) {
    return "";
  }
  return `
    <section class="panel action-panel">
      <div class="section-heading">
        <h2>行動</h2>
        <p class="muted">実行前に時間・スタミナコストを確認できます。</p>
      </div>
      <div class="action-grid">
        ${view.actions.map((action) => `
          <article class="action-card">
            <h3>${escapeHtml(action.label)}</h3>
            <p>時間 ${escapeHtml(action.timeCostMinutes)} 分 / スタミナ ${escapeHtml(action.staminaCost)}</p>
            ${button("実行", "perform-action", {
    value: action.id,
    disabled: !view.canSave,
  })}
          </article>
        `).join("")}
      </div>
      <div class="toolbar">
        ${button("イベント確認", "check-event")}
        ${button("仮イベント解放（動作確認用）", "unlock-sample-event", { kind: "quiet" })}
      </div>
    </section>
  `;
}

function game(view) {
  return `
    <section class="game-screen">
      <div class="game-layout">
        <section class="scene panel" aria-label="ゲーム画面">
          ${renderScenePresentation(view.presentation)}
          <div class="scene-heading">
            <span>${escapeHtml(view.stageNumber)} / 52</span>
            <h1>${escapeHtml(view.stageTitle)}</h1>
          </div>
          <div class="scene-status">
            <span>${escapeHtml(view.time.period)} ${escapeHtml(view.time.time)}</span>
            <span>${escapeHtml(view.time.date)}</span>
            <span>スタミナ ${escapeHtml(view.displayStamina)} / ${escapeHtml(view.maxStamina)}</span>
          </div>
          ${dialogue(view)}
        </section>
        <aside class="sidebar">
          <section class="panel compact-panel">
            <h2>ステータス</h2>
            <label class="meter-label" for="stamina-meter">スタミナ</label>
            <progress id="stamina-meter" max="${escapeHtml(view.maxStamina)}" value="${escapeHtml(view.displayStamina)}"></progress>
            <p>${escapeHtml(view.displayStamina)} / ${escapeHtml(view.maxStamina)}</p>
            ${statusDetails(view)}
          </section>
          <section class="panel compact-panel">
            <h2>ゲームメニュー</h2>
            <div class="stack">
              ${button("セーブ", "save-screen", { disabled: !view.canSave })}
              ${button("ロード", "load-screen")}
              ${button("メニュー", "menu")}
            </div>
          </section>
        </aside>
      </div>
      ${actionList(view)}
      ${view.stageTransitionPending ? `
        <section class="stage-confirm panel" role="dialog" aria-labelledby="stage-confirm-title">
          <h2 id="stage-confirm-title">ステージ終了</h2>
          <p>現在のステージを終了して次へ進みますか？</p>
          ${button("次のステージへ", "confirm-stage", { kind: "primary" })}
        </section>
      ` : ""}
    </section>
  `;
}

function formatSavedAt(value) {
  if (!value) {
    return "未保存";
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "日時不明" : date.toLocaleString("ja-JP");
}

function saves(view) {
  return `
    <section class="panel">
      <p class="eyebrow">${view.saveMode === "save" ? "SAVE" : "LOAD"}</p>
      <h1>${view.saveMode === "save" ? "セーブ" : "ロード"}</h1>
      <p class="muted">保存日時と進行ステージを確認できます。オートセーブは自動で更新されます。</p>
      ${view.saveMode === "load" ? `
        <div class="import-save-panel">
          ${button("エクスポート済みJSONをクラウドへ取り込む", "import-save", { kind: "quiet" })}
          <input id="save-import-file" class="visually-hidden" type="file" accept="application/json,.json" aria-label="インポートするセーブJSON">
          <p class="muted small">選択したJSON内のスロットに取り込みます。既存のクラウドセーブは確認後に上書きします。</p>
        </div>
      ` : ""}
      <div class="slot-grid">
        ${view.slots.map((slot) => {
    const stage = slot.progress
      ? view.stageTitles[slot.progress.currentStageId] ?? slot.progress.currentStageId
      : "—";
    const corrupted = Boolean(slot.corrupted);
    const canSave = view.saveMode === "save" && slot.type === "manual" &&
      view.canSave && !corrupted;
    const canLoad = view.saveMode === "load" && slot.occupied && !corrupted;
    return `
            <article class="slot-card${corrupted ? " is-corrupted" : ""}">
              <h2>${slot.type === "auto" ? "オートセーブ" : `手動セーブ ${escapeHtml(slot.slotId.slice(-1))}`}</h2>
              <p>ステージ: ${escapeHtml(stage)}</p>
              <p>保存日時: ${escapeHtml(formatSavedAt(slot.savedAt))}</p>
              ${corrupted ? `<p class="error-text">破損: ${escapeHtml(slot.error)}</p>` : ""}
              <div class="toolbar">
                ${view.saveMode === "save" && slot.type === "manual"
      ? button(slot.occupied ? "上書き保存" : "保存", "save-slot", {
        value: slot.slotId,
        disabled: !canSave,
      })
      : ""}
                ${view.saveMode === "load"
      ? button("ロード", "load-slot", {
        value: slot.slotId,
        disabled: !canLoad,
      })
      : ""}
                ${slot.occupied && !corrupted
      ? button("JSONエクスポート", "export-slot", {
        value: slot.slotId,
        kind: "quiet",
      })
      : ""}
              </div>
            </article>
          `;
  }).join("")}
      </div>
      ${button("戻る", view.engine ? "game" : "home", { kind: "quiet" })}
    </section>
  `;
}

function settings(view) {
  return `
    <section class="panel narrow-panel">
      <p class="eyebrow">CONFIG / 仮画面</p>
      <h1>設定</h1>
      <section class="account-panel">
        <h2>クラウドアカウント</h2>
        <p>状態: ${escapeHtml(view.authStatus ?? "未接続")}</p>
        ${view.googleLinked
    ? `<p class="muted">Googleアカウントと連携済みです。</p>`
    : button("Googleアカウントを連携", "connect-google", { kind: "primary" })}
        <p class="muted small">セーブはFirebaseクラウドに保存されます。認証情報はWebhookへ送信しません。</p>
      </section>
      <h2>操作方法</h2>
      <ul class="instruction-list">
        <li>ボタンはマウス・タッチで操作できます。</li>
        <li>イベント会話中は Enter または Space で会話を送れます。</li>
        <li>Esc でゲームメニューを開閉します。</li>
      </ul>
      <p class="muted">正式な設定項目・デザインは後工程で接続します。</p>
      ${button("戻る", view.engine ? "game" : "home", { kind: "quiet" })}
    </section>
  `;
}

function endings(view) {
  return `
    <section class="panel">
      <p class="eyebrow">ENDING COLLECTION</p>
      <h1>エンディング一覧</h1>
      <p class="collection-rate">回収率 ${escapeHtml(view.endingRate.collected)} / ${escapeHtml(view.endingRate.total)}
        （${escapeHtml(Math.round(view.endingRate.rate * 100))}%）</p>
      <div class="ending-grid">
        ${view.endings.map((ending) => `
          <article class="ending-card${ending.collected ? " is-collected" : ""}">
            <h2>${ending.collected ? escapeHtml(ending.title) : "？？？"}</h2>
            <p>${ending.collected ? "回収済み" : "未回収"}</p>
          </article>
        `).join("")}
      </div>
      ${button("戻る", view.engine ? "game" : "home", { kind: "quiet" })}
    </section>
  `;
}

function result(view) {
  return `
    <section class="panel result-screen">
      <p class="eyebrow">RESULT</p>
      <h1>${escapeHtml(view.resultTitle)}</h1>
      <p>${escapeHtml(view.resultMessage)}</p>
      ${view.resultDialogue.map(resultText).join("")}
      ${button("ホームへ戻る", "home", { kind: "primary" })}
      ${button("エンディング一覧", "endings")}
    </section>
  `;
}

function menu() {
  return `
    <section class="panel narrow-panel">
      <p class="eyebrow">MENU</p>
      <h1>メニュー</h1>
      <div class="stack">
        ${button("ゲームへ戻る", "game", { kind: "primary" })}
        ${button("セーブ", "save-screen")}
        ${button("ロード", "load-screen")}
        ${button("設定", "settings")}
        ${button("ホーム", "home", { kind: "quiet" })}
      </div>
      <p class="muted small">Esc でゲームへ戻ります。</p>
    </section>
  `;
}

function loading() {
  return `
    <section class="panel narrow-panel loading-panel" role="status" aria-busy="true">
      <p class="eyebrow">LOADING</p>
      <h1>ロードしています</h1>
      <p class="muted">セーブデータを確認しています。</p>
      <span class="loading-indicator" aria-hidden="true"></span>
    </section>
  `;
}

export function renderApp(view) {
  let content;
  switch (view.screen) {
    case "loading":
      content = loading();
      break;
    case "config":
      content = config();
      break;
    case "game":
      content = game(view);
      break;
    case "save":
    case "load":
      content = saves(view);
      break;
    case "settings":
      content = settings(view);
      break;
    case "endings":
      content = endings(view);
      break;
    case "result":
      content = result(view);
      break;
    case "menu":
      content = menu();
      break;
    default:
      content = home(view);
  }

  return `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#" data-action="home">天依わな育成シミュレーション <span>仮UI</span></a>
        ${navigation(Boolean(view.engine))}
      </header>
      ${view.message ? `<p class="notice${view.message.type === "error" ? " notice--error" : ""}" role="${view.message.type === "error" ? "alert" : "status"}">${escapeHtml(view.message.text)}</p>` : ""}
      <main class="page-content">${content}</main>
      <footer class="footer">開発用サンプル / 正式デザイン・シナリオではありません</footer>
    </div>
  `;
}
