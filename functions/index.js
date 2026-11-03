import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/https";

initializeApp();

const database = getFirestore();
const loginWebhookUrl = defineSecret("LOGIN_WEBHOOK_URL");
const NOTIFICATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const notifyAuthenticationSuccess = onCall(
  { region: "us-central1", secrets: [loginWebhookUrl] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const webhookUrl = loginWebhookUrl.value();
    if (!webhookUrl) {
      return { sent: false };
    }
    let destination;
    try {
      destination = new URL(webhookUrl);
    } catch {
      throw new HttpsError("failed-precondition", "Notification destination is invalid.");
    }
    if (destination.protocol !== "https:") {
      throw new HttpsError("failed-precondition", "Notification destination must use HTTPS.");
    }

    const rateLimitReference = database.doc(`system/authNotifications/${uid}`);
    const now = Date.now();
    const allowed = await database.runTransaction(async (transaction) => {
      const existing = await transaction.get(rateLimitReference);
      const previousTime = existing.data()?.sentAt;
      if (typeof previousTime === "number" && now - previousTime < NOTIFICATION_COOLDOWN_MS) {
        return false;
      }
      transaction.set(rateLimitReference, { sentAt: now });
      return true;
    });
    if (!allowed) {
      return { sent: false, reason: "cooldown" };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "ゲームへの認証が成功しました。",
          text: "ゲームへの認証が成功しました。",
          event: "authentication_succeeded",
          occurredAt: new Date(now).toISOString(),
        }),
      });
      if (!response.ok) {
        throw new Error(`Webhook responded with status ${response.status}.`);
      }
      return { sent: true };
    } catch {
      logger.error("Authentication success webhook delivery failed.");
      throw new HttpsError("internal", "Notification delivery failed.");
    }
  },
);
