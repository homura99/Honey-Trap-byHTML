import assert from "node:assert/strict";
import test from "node:test";
import { initializeFirebase } from "../src/firebase/client.js";

test("requires explicit Firebase Web app configuration", () => {
  assert.throws(
    () => initializeFirebase({}),
    /VITE_FIREBASE_API_KEY.*VITE_FIREBASE_AUTH_DOMAIN.*VITE_FIREBASE_PROJECT_ID.*VITE_FIREBASE_APP_ID/,
  );
});
