import { renderScenePresentation } from "./presentation.js";

const NUMBER_FORMATTER = new Intl.NumberFormat("ja-JP");

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

function parameterChangeText(preview) {
  if (!preview) {
    return "現在は実行できません";
  }
  const labels = {
    affection: "好感度",
    stamina: "スタミナ",
    subscribers: "登録者数",
  };
  return Object.entries(preview.parameterChanges)
    .filter(([, amount]) => amount !== 0)
    .map(([parameter, amount]) =>
      `${labels[parameter] ?? parameter} ${amount > 0 ? "+" : ""}${amount}`,
    )
    .join(" / ") || "状態変化なし";
}

function navigation(gameActive) {
  return `
    <nav class="top-nav" aria-label="メニュー">
      ${gameActive ? button("本編へ戻る", "game", { kind: "quiet" }) : ""}
      ${button("タイトル", "home", { kind: "quiet" })}
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
      <p class="muted small">背景と文章を中心に物語が進みます。背景・シルエットは開発用CSS表現です。</p>
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

function dialogue(view) {
  if (!view.event) {
    return `
      <section class="dialogue-window narration-window" aria-label="地の文">
        <span class="speaker">地の文</span>
        <p>${escapeHtml(view.message?.type === "status" ? view.message.text : "静かな時間が流れている。次の行動を選ぶか、イベントを確認しよう。")}</p>
        <span class="dialogue-hint">行動を選ぶか、発生可能なイベントを確認してください。</span>
        <div class="dialogue-controls">
          ${button(
    view.actionsPanelOpen ? "行動を閉じる" : "行動を選ぶ",
    "toggle-actions",
    { kind: "primary", disabled: !view.canPerformActions },
  )}
          ${button("イベント確認", "check-event")}
        </div>
        ${view.actionsPanelOpen ? actionChoices(view) : ""}
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
    : button("次へ", "advance-dialogue", { kind: "primary" });

  return `
    <section class="dialogue-window dialogue-window--${escapeHtml(displayMode)}${isNarration ? " narration-window" : ""}" aria-label="${isNarration ? "イベント地の文" : "イベント会話"}">
    ${isNarration ? "" : `<span class="speaker">${escapeHtml(line.speaker)}</span>`}
    <p>${escapeHtml(line?.text ?? "（会話データがありません）")}</p>
    <span class="dialogue-hint">${view.dialogueFinished ? "選択してください" : "クリック・タップ・Enter / Space で次へ"}</span>
    ${button(
    displayMode === "bottom" ? "全画面表示に切り替え" : "通常表示に切り替え",
    "toggle-display-mode",
    { kind: "quiet" },
  )}
    ${eventControls}
    ${view.event.deferPolicy?.enabled
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

function actionChoices(view) {
  return `
    <section class="scene-action-panel" aria-label="行動選択肢">
      <p class="scene-action-hint">ホバーまたはフォーカスで、実行後の変化を確認できます。</p>
      <div class="scene-action-grid">
        ${view.actions.map((action) => {
    const preview = action.preview;
    return `
          <article class="scene-action-choice">
            <div class="scene-action-preview">
              <p>${escapeHtml(action.description ?? "この行動の説明は未設定です。")}</p>
              <p>スタミナ消費 ${escapeHtml(preview?.staminaCost ?? "—")} ・ ${escapeHtml(parameterChangeText(preview))}</p>
            </div>
            ${button(
    `${action.label} ・ ${preview?.timeCostMinutes ?? action.timeCostMinutes}分`,
    "perform-action",
    {
      value: action.id,
      disabled: !view.canPerformActions || !preview,
    },
  )}
          </article>
        `;
  }).join("")}
      </div>
    </section>
  `;
}

function actionSelection(view) {
  return `
    <section class="panel selection-screen">
      <p class="eyebrow">DAILY ACTIONS</p>
      <h1>行動を選ぶ</h1>
      <p class="muted">時間と状態変化はゲームエンジンの現在値から算出しています。</p>
      <div class="action-grid">
        ${view.actions.map((action) => {
    const preview = action.preview;
    const changes = parameterChangeText(preview);
    return `
          <article class="action-card">
            <h2>${escapeHtml(action.label)}</h2>
            <p>${escapeHtml(action.description ?? "この行動の説明は未設定です。")}</p>
            <dl class="action-facts">
              <dt>所要時間</dt><dd>${escapeHtml(preview?.timeCostMinutes ?? action.timeCostMinutes)} 分</dd>
              <dt>消費スタミナ</dt><dd>${escapeHtml(preview?.staminaCost ?? "—")}</dd>
              <dt>実行後の変化</dt><dd>${escapeHtml(changes)}</dd>
              <dt>実行可否</dt><dd>${preview ? "実行可能" : "実行不可"}</dd>
            </dl>
            ${button("この行動を実行", "perform-action", {
      value: action.id,
      kind: "primary",
      disabled: !view.canPerformActions || !preview,
    })}
          </article>
        `;
  }).join("")}
      </div>
      ${button("物語へ戻る", "game", { kind: "quiet" })}
    </section>
  `;
}

function game(view) {
  return `
    <section class="game-screen">
      <section class="scene" aria-label="サウンドノベル画面" data-scene-click>
        ${renderScenePresentation(view.presentation)}
        <div class="scene-heading">
          <span>STAGE ${escapeHtml(view.stageNumber)} / 52</span>
          <h1>${escapeHtml(view.stageTitle)}</h1>
        </div>
        <section class="scene-parameters" aria-label="現在のパラメータ">
          <div class="scene-parameter">
            <div><span>スタミナ</span><strong>${escapeHtml(view.displayStamina)} / ${escapeHtml(view.maxStamina)}</strong></div>
            <meter min="0" max="${escapeHtml(view.maxStamina)}" value="${escapeHtml(view.displayStamina)}" aria-label="スタミナ"></meter>
          </div>
          <div class="scene-parameter">
            <div><span>好感度</span><strong>${escapeHtml(view.affection)}</strong></div>
            <meter min="${escapeHtml(view.affectionMin)}" max="${escapeHtml(view.affectionMax)}" value="${escapeHtml(view.affection)}" aria-label="好感度"></meter>
          </div>
          <div class="scene-parameter scene-parameter--count">
            <span>登録者数</span><strong>${escapeHtml(NUMBER_FORMATTER.format(view.subscribers))}</strong>
          </div>
        </section>
        <nav class="scene-controls" aria-label="ゲーム補助メニュー">
          ${button("ログ", "backlog", { kind: "quiet" })}
          ${view.event ? button(view.autoPlayEnabled ? "オート停止" : "オート", "toggle-auto-play", { kind: "quiet" }) : ""}
          ${view.event ? button(view.skipReadEnabled ? "既読スキップ中" : "既読スキップ", "toggle-skip-read", { kind: "quiet" }) : ""}
          ${button("メニュー", "menu", { kind: "quiet" })}
        </nav>
        ${dialogue(view)}
        ${view.stageTransitionPending ? `
          <section class="stage-confirm panel" role="dialog" aria-labelledby="stage-confirm-title">
            <h2 id="stage-confirm-title">ステージ終了</h2>
            <p>現在のステージを終了して次へ進みますか？</p>
            ${button("次のステージへ", "confirm-stage", { kind: "primary" })}
          </section>
        ` : ""}
      </section>
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
        <li>本編画面のクリック・タップ、Enter、Space で文章を送れます。</li>
        <li>オート再生と既読スキップは本編画面から切り替えられます。</li>
        <li>Esc で本編と補助画面を切り替えます。</li>
      </ul>
      <p class="muted">オート再生・既読スキップは、イベント会話中に本編画面から切り替えられます。</p>
      ${button("戻る", view.engine ? "game" : "home", { kind: "quiet" })}
    </section>
  `;
}

function statusScreen(view) {
  return `
    <section class="panel selection-screen">
      <p class="eyebrow">STATUS</p>
      <h1>ステータス</h1>
      <dl class="detail-grid status-grid">
        <dt>現在時刻</dt><dd>${escapeHtml(view.time.date)} / ${escapeHtml(view.time.period)} ${escapeHtml(view.time.time)}</dd>
        <dt>ステージ</dt><dd>${escapeHtml(view.stageNumber)} / 52 ・ ${escapeHtml(view.stageTitle)}</dd>
        <dt>スタミナ</dt><dd>${escapeHtml(view.displayStamina)} / ${escapeHtml(view.maxStamina)}</dd>
        <dt>好感度</dt><dd>${escapeHtml(view.affection)}</dd>
        <dt>登録者数</dt><dd>${escapeHtml(NUMBER_FORMATTER.format(view.subscribers))}</dd>
        <dt>難易度</dt><dd>${escapeHtml(view.difficultyLabel)}</dd>
        <dt>イベント履歴</dt><dd>${escapeHtml(view.eventHistoryCount)} 件</dd>
        <dt>保留イベント</dt><dd>${escapeHtml(view.pendingEventCount)} 件</dd>
        <dt>ストーリーフラグ</dt><dd>${escapeHtml(view.storyFlagSummary)}</dd>
      </dl>
      <div class="toolbar">${button("物語へ戻る", "game", { kind: "primary" })}</div>
    </section>
  `;
}

function backlogScreen(view) {
  return `
    <section class="panel selection-screen">
      <p class="eyebrow">BACKLOG</p>
      <h1>バックログ</h1>
      ${view.backlog.length
    ? `<ol class="backlog-list">${view.backlog.map((entry) => `
            <li>
              ${entry.speaker ? `<strong>${escapeHtml(entry.speaker)}</strong>` : ""}
              <p>${escapeHtml(entry.text)}</p>
            </li>
          `).join("")}</ol>`
    : `<p class="muted">まだ読んだ文章はありません。</p>`}
      ${button("物語へ戻る", "game", { kind: "primary" })}
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

function menu(view) {
  return `
    <section class="panel narrow-panel">
      <p class="eyebrow">MENU</p>
      <h1>メニュー</h1>
      <div class="stack">
        ${button("ゲームへ戻る", "game", { kind: "primary" })}
        ${button("行動を選ぶ", "actions", { disabled: !view.canPerformActions })}
        ${button("ステータス", "status")}
        ${button("バックログ", "backlog")}
        ${button("セーブ", "save-screen", { disabled: !view.canSave })}
        ${button("ロード", "load-screen")}
        ${button("設定", "settings")}
        ${button("エンディング一覧", "endings")}
        ${button("仮イベント解放（開発用）", "unlock-sample-event", { kind: "quiet" })}
        ${button("タイトルへ戻る", "home", { kind: "quiet" })}
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
    case "actions":
      content = actionSelection(view);
      break;
    case "status":
      content = statusScreen(view);
      break;
    case "backlog":
      content = backlogScreen(view);
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
      content = menu(view);
      break;
    default:
      content = home(view);
  }

  const isGame = view.screen === "game";
  return `
    <div class="app-shell${isGame ? " app-shell--game" : ""}">
      ${isGame ? "" : `<header class="topbar">
        <a class="brand" href="#" data-action="home">天依わな育成シミュレーション <span>仮UI</span></a>
        ${navigation(Boolean(view.engine))}
      </header>`}
      ${view.message && (!isGame || view.message.type === "error") ? `<p class="notice${view.message.type === "error" ? " notice--error" : ""}" role="${view.message.type === "error" ? "alert" : "status"}">${escapeHtml(view.message.text)}</p>` : ""}
      <main class="page-content">${content}</main>
      ${isGame ? "" : `<footer class="footer">開発用サンプル / 正式デザイン・シナリオではありません</footer>`}
    </div>
  `;
}
