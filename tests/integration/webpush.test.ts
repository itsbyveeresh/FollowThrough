import { createECDH, createPublicKey, randomBytes, verify as verifySig } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import webpush from "web-push";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ece = require("http_ece") as { decrypt: (buf: Buffer, opts: Record<string, unknown>) => Buffer };
import { createWebPushSender } from "@/server/push";

/**
 * Exercises the real web-push library end to end against a local TLS "push
 * service": VAPID JWT must verify against our public key, and the aes128gcm
 * payload must decrypt with the subscription's private key — exactly what
 * Google/Mozilla/Apple push services and the browser do.
 */
const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"]);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasOpenssl)("real Web Push encryption and VAPID", () => {
  let server: https.Server;
  let port = 0;
  let agent: https.Agent;
  const received: { headers: import("node:http").IncomingHttpHeaders; body: Buffer; path: string }[] = [];
  const vapid = webpush.generateVAPIDKeys();
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const authSecret = randomBytes(16);

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ft-push-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${dir}/k.pem`, "-out", `${dir}/c.pem`,
      "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
    const cert = fs.readFileSync(`${dir}/c.pem`);
    server = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks), path: req.url ?? "" });
        const status = req.url?.includes("gone") ? 410 : req.url?.includes("busy") ? 503 : 201;
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
    agent = new https.Agent({ ca: cert });
    process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.VAPID_SUBJECT = "mailto:test@example.test";
  });
  afterAll(() => server?.close());

  const target = (p: string) => ({
    endpoint: `https://localhost:${port}/${p}`,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: authSecret.toString("base64url"),
  });

  it("sends an encrypted payload the subscription can decrypt, with a valid VAPID signature", async () => {
    const sender = createWebPushSender(agent)!;
    const payload = JSON.stringify({ title: "FollowThrough", body: "You have a follow-up due.", url: "/tasks/x" });
    const res = await sender.send(target("ok"), payload, { ttlSeconds: 600, urgency: "high", topic: "abc123" });
    expect(res).toEqual({ ok: true, status: 201 });
    const req = received.at(-1)!;
    expect(req.headers["content-encoding"]).toBe("aes128gcm");
    expect(req.headers.ttl).toBe("600");
    expect(req.headers.urgency).toBe("high");
    expect(req.headers.topic).toBe("abc123");

    // Decrypt as the browser would.
    const plain = ece.decrypt(req.body, { version: "aes128gcm", privateKey: ecdh, authSecret: authSecret.toString("base64url") });
    expect(JSON.parse(plain.toString())).toMatchObject({ body: "You have a follow-up due." });

    // Verify the VAPID JWT (ES256) against our public key, as the push service does.
    const m = /vapid t=([^,]+), k=(.+)/.exec(String(req.headers.authorization))!;
    expect(m[2]).toBe(vapid.publicKey);
    const [h, p, s] = m[1].split(".");
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims.aud).toBe(`https://localhost:${port}`);
    expect(claims.sub).toBe("mailto:test@example.test");
    const pub = Buffer.from(vapid.publicKey, "base64url");
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") },
      format: "jwk",
    });
    expect(verifySig("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("classifies expired subscriptions and transient push-service errors", async () => {
    const sender = createWebPushSender(agent)!;
    expect(await sender.send(target("gone"), "{}", { ttlSeconds: 60, urgency: "normal" })).toMatchObject({ ok: false, kind: "gone", status: 410 });
    expect(await sender.send(target("busy"), "{}", { ttlSeconds: 60, urgency: "normal" })).toMatchObject({ ok: false, kind: "transient", status: 503 });
    const down = await sender.send({ ...target("x"), endpoint: "https://localhost:1/x" }, "{}", { ttlSeconds: 60, urgency: "normal" });
    expect(down).toMatchObject({ ok: false, kind: "transient", status: null });
    expect((down as { error: string }).error).not.toContain("localhost");
  });

  it("returns null (not a silent mock) when VAPID keys are missing", () => {
    const saved = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(createWebPushSender()).toBeNull();
    process.env.VAPID_PRIVATE_KEY = saved;
  });
});
