import { expect, type Page } from "@playwright/test";

export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
export const PASSWORD = "correct-horse-battery";

export async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/today/);
}

export async function signIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** "yyyy-MM-dd" in UTC (new accounts default to the UTC time zone). */
export function utcDate(offsetDays: number, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offsetDays));
  return d.toISOString().slice(0, 10);
}

/** The first Friday at least two days from today (UTC). */
export function upcomingFriday(): string {
  for (let i = 2; i < 10; i++) {
    const d = utcDate(i);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 5) return d;
  }
  throw new Error("unreachable");
}

/** A confirmation toast (role=status/alert) with exactly this text. */
export function toast(page: Page, text: string) {
  return page.locator('[role="status"],[role="alert"]').filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
}
