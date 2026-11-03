import "./style.css";
import { gameData } from "./data/runtime-data.js";
import {
  connectGoogleAccount,
  ensureAnonymousSession,
  initializeFirebase,
} from "./firebase/client.js";
import { GameApp } from "./ui/app.js";
import { FirestoreSaveRepository } from "./storage/firestore-save-repository.js";

const root = document.querySelector("#app");

if (!(root instanceof HTMLElement)) {
  throw new Error("アプリ画面の表示領域が見つかりません。");
}

async function startGame() {
  const firebase = initializeFirebase(import.meta.env);
  const repository = new FirestoreSaveRepository(gameData, firebase.auth, firebase.database);
  const session = await ensureAnonymousSession(firebase.auth);
  let notificationError = null;
  if (session.created && firebase.notifyAuthSuccess) {
    try {
      await firebase.notifyAuthSuccess();
    } catch (error) {
      notificationError = error;
    }
  }
  const app = new GameApp(root, gameData, repository, {
    authUser: session.user,
    connectGoogle: async () => {
      const result = await connectGoogleAccount(firebase.auth);
      if (firebase.notifyAuthSuccess) {
        try {
          await firebase.notifyAuthSuccess();
        } catch (notificationError) {
          return { ...result, notificationError };
        }
      }
      return result;
    },
  });
  app.mount();
  firebase.onAuthStateChanged((user) => {
    void app.updateAuthUser(user);
  });
  if (notificationError) {
    app.showMessage(
      `認証は完了しましたが、Webhook通知に失敗しました: ${notificationError instanceof Error ? notificationError.message : String(notificationError)}`,
      "error",
    );
  }
}

startGame().catch((error) => {
  const section = document.createElement("section");
  section.className = "panel error-panel";
  section.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "Firebaseに接続できません";
  const message = document.createElement("p");
  message.textContent = error instanceof Error
    ? error.message
    : String(error);
  section.append(heading, message);
  root.replaceChildren(section);
});
