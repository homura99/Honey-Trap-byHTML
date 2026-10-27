import "./style.css";

const status = document.querySelector(".status");

if (!(status instanceof HTMLParagraphElement)) {
  throw new Error("初期画面のステータス要素が見つかりません。");
}

status.textContent = "開発基盤を起動しました。";
