import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const REQUIRED_CONFIG_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
];

export function initializeFirebase(environment) {
  const config = {
    apiKey: environment.VITE_FIREBASE_API_KEY,
    authDomain: environment.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: environment.VITE_FIREBASE_PROJECT_ID,
    appId: environment.VITE_FIREBASE_APP_ID,
    messagingSenderId: environment.VITE_FIREBASE_MESSAGING_SENDER_ID,
    storageBucket: environment.VITE_FIREBASE_STORAGE_BUCKET,
  };
  const missingKeys = REQUIRED_CONFIG_KEYS.filter((key) => !config[key]);
  if (missingKeys.length > 0) {
    throw new Error(
      `Firebase設定が不足しています。 .env.local に VITE_FIREBASE_${missingKeys.map((key) => key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()).join(", VITE_FIREBASE_")} を設定してください。`,
    );
  }

  const app = initializeApp(config);
  const auth = getAuth(app);
  const database = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  const notifyAuthSuccess = environment.VITE_AUTH_WEBHOOK_ENABLED === "true"
    ? httpsCallable(functions, "notifyAuthenticationSuccess")
    : null;

  return {
    auth,
    database,
    onAuthStateChanged: (callback) => onAuthStateChanged(auth, callback),
    notifyAuthSuccess,
  };
}

export async function ensureAnonymousSession(auth) {
  await auth.authStateReady();
  if (auth.currentUser) {
    return { user: auth.currentUser, created: false };
  }
  const result = await signInAnonymously(auth);
  return { user: result.user, created: true };
}

export async function connectGoogleAccount(auth) {
  const provider = new GoogleAuthProvider();
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("認証状態を確認できません。ページを再読み込みしてください。");
  }
  if (!currentUser.isAnonymous) {
    return { user: currentUser, switchedAccount: false };
  }

  try {
    const result = await linkWithPopup(currentUser, provider);
    return { user: result.user, switchedAccount: false };
  } catch (error) {
    if (error?.code !== "auth/credential-already-in-use" &&
      error?.code !== "auth/email-already-in-use") {
      throw error;
    }
    const credential = GoogleAuthProvider.credentialFromError(error);
    if (!credential) {
      throw error;
    }
    const result = await signInWithCredential(auth, credential);
    return { user: result.user, switchedAccount: true };
  }
}
