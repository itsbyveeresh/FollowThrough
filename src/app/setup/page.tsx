import type { Metadata } from "next";
import { configProblems } from "@/server/env";

export const metadata: Metadata = { title: "Setup required" };
export const dynamic = "force-dynamic";

/** Shown instead of the app when required server configuration is missing. Lists variable names only, never values. */
export default function SetupPage() {
  const problems = configProblems();
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">FollowThrough needs setup</h1>
      {problems.length === 0 ? (
        <p className="mt-3">All required settings are present. <a className="text-accent underline" href="/login">Continue to sign in</a>.</p>
      ) : (
        <>
          <p className="mt-3 text-muted">The server is missing these environment variables:</p>
          <ul className="mt-4 flex flex-col gap-2">
            {problems.map((p) => (
              <li key={p.variable} className="rounded-lg border border-border bg-surface px-4 py-3">
                <code className="font-mono text-sm">{p.variable}</code>
                <p className="text-sm text-muted">{p.impact}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm">
            Follow <code>docs/SETUP.md</code> in the project, set the variables in your hosting provider (e.g. Vercel → Project → Settings →
            Environment Variables), then redeploy.
          </p>
        </>
      )}
    </main>
  );
}
