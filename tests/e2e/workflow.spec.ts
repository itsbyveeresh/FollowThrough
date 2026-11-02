import { expect, test } from "@playwright/test";
import { signIn, signUp, toast, uniqueEmail, upcomingFriday, utcDate } from "./helpers";

test.describe.configure({ mode: "serial" });

const email = uniqueEmail("raj-flow");
let taskUrl = "";

test("create a waiting task, log a follow-up, schedule the next one and complete it", async ({ page }) => {
  await signUp(page, email);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  // 1. Create "Collect documents from Raj", Waiting On, follow-up tomorrow 10:00.
  await page.getByRole("button", { name: /^Quick add/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Title").fill("Collect documents from Raj");
  await dlg.getByRole("button", { name: "Add client, person, dates and reminders" }).click();
  await dlg.getByText("Waiting On", { exact: true }).click();
  await dlg.getByLabel("Waiting on (person)").selectOption({ label: "＋ New person…" });
  await dlg.getByLabel("New person").fill("Raj");
  await dlg.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dlg.getByLabel("Waiting on (person)")).toHaveValue(/[0-9a-f-]{36}/);
  await dlg.getByLabel("Follow up at").fill(`${utcDate(1)}T10:00`);
  await dlg.getByRole("button", { name: "Add task" }).click();
  await expect(toast(page, "Task added")).toBeVisible();
  await expect(dlg).toBeHidden();

  // 2. It shows under Waiting On with a plain label.
  await page.getByRole("link", { name: "Waiting On" }).first().click();
  await expect(page.getByRole("link", { name: "Collect documents from Raj" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Follow up tomorrow at 10 AM")).toBeVisible();
  await expect(page.getByRole("main").getByText("Waiting on Raj")).toBeVisible();

  // 3. Open it and log a follow-up with the next one on Friday 3 PM.
  await page.getByRole("link", { name: "Collect documents from Raj" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  taskUrl = page.url();
  await expect(page.getByRole("main").getByText("Follow-up · Scheduled")).toBeVisible();
  await page.getByRole("button", { name: "Log follow-up" }).click();
  const log = page.getByRole("dialog");
  await log.getByText("Phone", { exact: true }).click();
  await log.getByLabel("What happened?").fill("Called; Raj will send documents Friday");
  await log.getByLabel("Outcome").fill("Promised Friday");
  const friday = upcomingFriday();
  await log.getByLabel("Next follow-up").fill(`${friday}T15:00`);
  await log.getByRole("button", { name: "Save follow-up" }).click();
  await expect(toast(page, "Follow-up logged and next one scheduled")).toBeVisible();
  await expect(log).toBeHidden();

  // History and reminders: old reminder cancelled, new one scheduled.
  await expect(page.getByRole("main").getByText("Called; Raj will send documents Friday")).toBeVisible();
  await expect(page.getByRole("main").getByText("Outcome: Promised Friday")).toBeVisible();
  await expect(page.getByRole("main").getByText("Follow-up logged · Phone")).toBeVisible();
  await expect(page.getByRole("main").getByText(/Follow up (Friday|Fri \d+ \w+) at 3 PM/)).toBeVisible();
  await expect(page.getByRole("main").getByText("Follow-up · Cancelled")).toBeVisible();
  await expect(page.getByRole("main").getByText("Follow-up · Scheduled")).toBeVisible();

  // 4. Survives a refresh (stored on the server).
  await page.reload();
  await expect(page.getByRole("main").getByText("Called; Raj will send documents Friday")).toBeVisible();

  // 5. Snooze keeps the follow-up date.
  await page.getByRole("button", { name: "Snooze" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "1 hour" }).click();
  await expect(toast(page, "Reminder snoozed")).toBeVisible();
  await expect(page.getByRole("main").getByText(/Reminder snoozed until today at/)).toBeVisible();
  await expect(page.getByRole("main").getByText(/Follow up (Friday|Fri \d+ \w+) at 3 PM/)).toBeVisible();

  // 6. Completing cancels every pending reminder.
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(toast(page, "Task completed — pending reminders cancelled")).toBeVisible();
  await expect(page.getByRole("main").getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("main").getByText(/· Scheduled$/)).toHaveCount(0);
});

test("a notification link asks for sign-in and returns to the task", async ({ page }) => {
  expect(taskUrl).not.toBe("");
  const target = `${new URL(taskUrl).pathname}?from=notification`;
  await page.goto(target);
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("main").getByText("Sign in to continue to the page you opened.")).toBeVisible();
  await signIn(page, email);
  await expect(page).toHaveURL(new RegExp(`${target.replace("?", "\\?")}$`));
  await expect(page.getByRole("main").getByText("Opened from a reminder. Nothing has been marked as done")).toBeVisible();
});

test("another account cannot open the task", async ({ page }) => {
  await signUp(page, uniqueEmail("other"));
  await page.goto(new URL(taskUrl).pathname);
  await expect(page.getByRole("main").getByText("Task not found")).toBeVisible();
  await expect(page.getByRole("main").getByText("Collect documents from Raj")).toHaveCount(0);
  const res = await page.request.get(`/api/reminders/${new URL(taskUrl).pathname.split("/").pop()}`);
  expect(res.status()).toBe(404);
});

test("quick add suggests dates from natural language and asks when ambiguous", async ({ page }) => {
  await signUp(page, uniqueEmail("nlp"));
  await page.getByRole("button", { name: /^Quick add/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Title").fill("Follow up with Raj tomorrow at 11 AM");
  await expect(dlg.getByText(/Found “tomorrow at 11 AM”/)).toBeVisible();
  await dlg.getByRole("button", { name: "Use as follow-up" }).click();
  await expect(dlg.getByLabel("Follow up at")).toHaveValue(`${utcDate(1)}T11:00`);

  await dlg.getByLabel("Title").fill("Chase invoice tomorrow at 4");
  await expect(dlg.getByText("Did you mean 4 AM or 4 PM?")).toBeVisible();
  await dlg.getByRole("button", { name: "4 PM" }).click();
  await dlg.getByRole("button", { name: "Use as deadline" }).click();
  await expect(dlg.getByLabel("Due date")).toHaveValue(utcDate(1));
  await expect(dlg.getByLabel("Due time")).toHaveValue("16:00");
  await dlg.getByRole("button", { name: "Add task" }).click();
  await expect(toast(page, "Task added")).toBeVisible();
});

test("inbox capture needs only a title and can be planned", async ({ page }) => {
  await signUp(page, uniqueEmail("inbox"));
  await page.goto("/inbox");
  await page.getByLabel("New inbox item").fill("Idea: offer retainer to Acme");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(toast(page, "Captured")).toBeVisible();
  await expect(page.getByRole("link", { name: "Idea: offer retainer to Acme" })).toBeVisible();
  await page.getByRole("button", { name: "Plan as next action" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save plan" }).click();
  await expect(toast(page, "Changes saved")).toBeVisible();
  await expect(page.getByRole("main").getByText("Inbox zero")).toBeVisible();
  await page.goto("/tasks?status=next_action");
  await expect(page.getByRole("link", { name: "Idea: offer retainer to Acme" })).toBeVisible();
});

test("trash and restore", async ({ page }) => {
  await signUp(page, uniqueEmail("trash"));
  await page.goto("/inbox");
  await page.getByLabel("New inbox item").fill("Throwaway");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(toast(page, "Moved to trash")).toBeVisible();
  await page.goto("/trash");
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(toast(page, "Restored")).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByRole("link", { name: "Throwaway" })).toBeVisible();
});

test("password reset link signs in on any device and sets a new password", async ({ browser }) => {
  const resetEmail = uniqueEmail("reset");
  const first = await browser.newContext();
  await signUp(await first.newPage(), resetEmail);
  await first.close();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(resetEmail);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If an account exists for that email, a reset link is on its way.")).toBeVisible();

  await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(`e2e:${resetEmail}`)}&type=recovery&next=/reset-password`);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill("a-brand-new-passphrase");
  await page.getByLabel("Confirm new password").fill("a-brand-new-passphrase");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/today/);

  await ctx.close();

  // An invalid or expired link, opened while signed out, is explained on the sign-in page.
  const anon = await browser.newPage();
  await anon.goto("/auth/confirm?token_hash=bogus&type=recovery&next=/reset-password");
  await expect(anon).toHaveURL(/\/login\?error=link_invalid/);
  await expect(anon.getByText("That link is invalid or has expired.")).toBeVisible();
  await anon.close();
});
