import "server-only";

/**
 * Server configuration. Values are read lazily so a missing variable produces a
 * visible, explained setup problem instead of a crash at import time.
 */
export interface ServerConfig {
  supabaseUrl: string | null;
  supabaseKey: string | null;
  databaseUrl: string | null;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string | null;
  cronSecret: string | null;
  siteUrl: string | null;
}

function read(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export function serverConfig(): ServerConfig {
  return {
    supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseKey: read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    databaseUrl: read("DATABASE_URL"),
    vapidPublicKey: read("VAPID_PUBLIC_KEY"),
    vapidPrivateKey: read("VAPID_PRIVATE_KEY"),
    vapidSubject: read("VAPID_SUBJECT"),
    cronSecret: read("CRON_SECRET"),
    siteUrl: read("NEXT_PUBLIC_SITE_URL"),
  };
}

export interface ConfigProblem {
  variable: string;
  impact: string;
}

/** Which required settings are missing, in plain language. Never includes values. */
export function configProblems(cfg = serverConfig()): ConfigProblem[] {
  const out: ConfigProblem[] = [];
  if (!cfg.supabaseUrl) out.push({ variable: "NEXT_PUBLIC_SUPABASE_URL", impact: "Sign-in cannot work." });
  if (!cfg.supabaseKey)
    out.push({ variable: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", impact: "Sign-in cannot work." });
  if (!cfg.databaseUrl) out.push({ variable: "DATABASE_URL", impact: "Tasks cannot be loaded or saved." });
  if (!cfg.vapidPublicKey || !cfg.vapidPrivateKey || !cfg.vapidSubject)
    out.push({ variable: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT", impact: "Push reminders cannot be sent." });
  if (!cfg.cronSecret) out.push({ variable: "CRON_SECRET", impact: "The reminder scheduler endpoint is disabled." });
  if (cfg.cronSecret && cfg.cronSecret.length < 32)
    out.push({ variable: "CRON_SECRET", impact: "Too short: use at least 32 random characters." });
  return out;
}

export class ConfigError extends Error {
  constructor(public variable: string) {
    super(`Server is missing configuration: ${variable}`);
    this.name = "ConfigError";
  }
}

export function pushConfigured(cfg = serverConfig()): boolean {
  return !!(cfg.vapidPublicKey && cfg.vapidPrivateKey && cfg.vapidSubject);
}
