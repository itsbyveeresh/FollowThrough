/**
 * TEST-ONLY stand-in for the handful of Supabase Auth (GoTrue) endpoints the app
 * calls through @supabase/supabase-js: signup, password + refresh-token grants,
 * get user, logout and recover. It exists because the real Supabase stack can't
 * run in this CI sandbox. It is never used by the application at runtime; real
 * deployments use Supabase Auth. Users are inserted into auth.users of the E2E
 * database so the profile trigger, RLS and foreign keys behave as in production.
 */
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import http from "node:http";
import postgres from "postgres";

const PORT = Number(process.env.AUTH_EMULATOR_PORT ?? 54331);
const SECRET = process.env.AUTH_EMULATOR_JWT_SECRET ?? "e2e-only-jwt-secret-not-for-production-use";
const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 2, onnotice: () => {} });

interface User {
  id: string;
  email: string;
  hash: string;
  salt: string;
  createdAt: string;
}
const users = new Map<string, User>(); // by email
const refreshTokens = new Map<string, string>(); // token -> user id

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
function sign(payload: Record<string, unknown>) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}
function verify(token: string): Record<string, unknown> | null {
  const [h, b, s] = token.split(".");
  if (!h || !b || !s) return null;
  const expected = b64url(createHmac("sha256", SECRET).update(`${h}.${b}`).digest());
  if (expected.length !== s.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
  const payload = JSON.parse(Buffer.from(b, "base64url").toString());
  if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
  return payload;
}

function userJson(u: User) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.createdAt,
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: u.createdAt,
    updated_at: u.createdAt,
  };
}

function session(u: User) {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", aal: "aal1", session_id: randomUUID(), iat: now, exp: now + 3600, iss: `http://127.0.0.1:${PORT}/auth/v1` });
  const refresh = randomBytes(24).toString("hex");
  refreshTokens.set(refresh, u.id);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u) };
}

const send = (res: http.ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const fail = (res: http.ServerResponse, status: number, code: string, message: string) => send(res, status, { code, error_code: code, msg: message, message });

async function readBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    const path = url.pathname.replace(/^\/auth\/v1/, "");
    if (req.method === "POST" && path === "/signup") {
      const { email, password } = await readBody(req);
      const key = String(email).toLowerCase();
      if (users.has(key)) return send(res, 200, { ...userJson(users.get(key)!), identities: [] });
      const [row] = await sql`insert into auth.users (email, email_confirmed_at) values (${key}, now()) returning id, created_at`;
      const salt = randomBytes(16).toString("hex");
      const u: User = { id: row.id, email: key, salt, hash: scryptSync(password, salt, 32).toString("hex"), createdAt: new Date(row.created_at).toISOString() };
      users.set(key, u);
      return send(res, 200, session(u));
    }
    if (req.method === "POST" && path === "/token") {
      const grant = url.searchParams.get("grant_type");
      const body = await readBody(req);
      if (grant === "password") {
        const u = users.get(String(body.email).toLowerCase());
        if (!u || scryptSync(body.password, u.salt, 32).toString("hex") !== u.hash)
          return fail(res, 400, "invalid_credentials", "Invalid login credentials");
        return send(res, 200, session(u));
      }
      if (grant === "refresh_token") {
        const id = refreshTokens.get(body.refresh_token);
        refreshTokens.delete(body.refresh_token);
        const u = [...users.values()].find((x) => x.id === id);
        if (!u) return fail(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
        return send(res, 200, session(u));
      }
      return fail(res, 400, "unsupported_grant_type", "unsupported grant");
    }
    if (req.method === "GET" && path === "/user") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const claims = verify(token);
      const u = claims && [...users.values()].find((x) => x.id === claims.sub);
      if (!u) return fail(res, 401, "bad_jwt", "invalid JWT");
      return send(res, 200, userJson(u));
    }
    if (req.method === "POST" && path === "/logout") {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "POST" && path === "/recover") return send(res, 200, {});
    // Email links: the test passes token_hash = "e2e:<email>" (real Supabase emails a one-time hash).
    if (req.method === "POST" && path === "/verify") {
      const body = await readBody(req);
      const u = String(body.token_hash ?? "").startsWith("e2e:") ? users.get(String(body.token_hash).slice(4)) : undefined;
      if (!u) return fail(res, 403, "otp_expired", "Email link is invalid or has expired");
      return send(res, 200, session(u));
    }
    if (req.method === "PUT" && path === "/user") {
      const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      const u = claims && [...users.values()].find((x) => x.id === claims.sub);
      if (!u) return fail(res, 401, "bad_jwt", "invalid JWT");
      const body = await readBody(req);
      if (body.password) u.hash = scryptSync(body.password, u.salt, 32).toString("hex");
      return send(res, 200, userJson(u));
    }
    if (path === "/health") return send(res, 200, { ok: true });
    return fail(res, 404, "not_found", `Emulator does not implement ${req.method} ${path}`);
  } catch (e) {
    return fail(res, 500, "unexpected_failure", e instanceof Error ? e.message : "error");
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`auth emulator on ${PORT}`));
