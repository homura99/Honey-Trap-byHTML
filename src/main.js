import "./style.css";
import { gameData } from "./data/runtime-data.js";
import { GameApp } from "./ui/app.js";
import { IndexedDBSaveRepository } from "./storage/indexeddb-save-repository.js";

const root = document.querySelector("#app");

if (!(root instanceof HTMLElement)) {
  throw new Error("アプリ画面の表示領域が見つかりません。");
}

try {
  const repository = new IndexedDBSaveRepository(gameData);
  const app = new GameApp(root, gameData, repository);
  app.mount();
} catch (error) {
  const section = document.createElement("section");
  section.className = "panel error-panel";
  section.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "ゲームを起動できません";
  const message = document.createElement("p");
  message.textContent = error instanceof Error ? error.message : String(error);
  section.append(heading, message);
  root.replaceChildren(section);
}
