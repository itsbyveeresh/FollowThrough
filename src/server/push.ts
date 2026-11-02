import "server-only";
import type { Agent } from "node:https";
import webpush from "web-push";
import { serverConfig } from "./env";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendOptions {
  ttlSeconds: number;
  urgency: "very-low" | "low" | "normal" | "high";
  /** Push-service collapse key (≤32 URL-safe chars): a resend replaces an undelivered copy. */
  topic?: string;
}

export type SendResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; kind: "gone" | "permanent" | "transient"; error: string };

export interface PushSender {
  send(target: PushTarget, payload: string, opts: SendOptions): Promise<SendResult>;
}

/**
 * Classify a push-service failure. 404/410 mean the subscription is gone for good.
 * 429 and 5xx (and network errors) are transient and retried with backoff.
 * Other 4xx are permanent for this message (bad request, auth/VAPID problem, too large).
 * The error text is sanitized: never the endpoint, keys or response body.
 */
export function classifyPushError(e: unknown): SendResult {
  const status =
    typeof e === "object" && e && "statusCode" in e && typeof (e as { statusCode: unknown }).statusCode === "number"
      ? (e as { statusCode: number }).statusCode
      : null;
  if (status === 404 || status === 410) return { ok: false, status, kind: "gone", error: `HTTP ${status}: subscription expired` };
  if (status === 429) return { ok: false, status, kind: "transient", error: "HTTP 429: rate limited by push service" };
  if (status !== null && status >= 500) return { ok: false, status, kind: "transient", error: `HTTP ${status}: push service error` };
  if (status === 400) return { ok: false, status, kind: "permanent", error: "HTTP 400: push service rejected the request" };
  if (status === 401 || status === 403)
    return { ok: false, status, kind: "permanent", error: `HTTP ${status}: VAPID authorization rejected (check keys and subject)` };
  if (status === 413) return { ok: false, status, kind: "permanent", error: "HTTP 413: payload too large" };
  if (status !== null) return { ok: false, status, kind: "permanent", error: `HTTP ${status}: push service refused` };
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code).slice(0, 40) : "unknown";
  return { ok: false, status: null, kind: "transient", error: `Network error (${code.replace(/[^A-Z0-9_]/gi, "")})` };
}

/** Real Web Push sender (VAPID + aes128gcm). `agent` is only for tests with a local TLS push service. */
export function createWebPushSender(agent?: Agent): PushSender | null {
  const cfg = serverConfig();
  if (!cfg.vapidPublicKey || !cfg.vapidPrivateKey || !cfg.vapidSubject) return null;
  const vapidDetails = { subject: cfg.vapidSubject, publicKey: cfg.vapidPublicKey, privateKey: cfg.vapidPrivateKey };
  return {
    async send(target, payload, opts) {
      try {
        const res = await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          { vapidDetails, TTL: opts.ttlSeconds, urgency: opts.urgency, topic: opts.topic, timeout: 10_000, ...(agent ? { agent } : {}) },
        );
        return { ok: true, status: res.statusCode };
      } catch (e) {
        return classifyPushError(e);
      }
    },
  };
}
