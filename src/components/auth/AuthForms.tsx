"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, FormError, Input, Notice } from "@/components/ui/controls";
import {
  requestPasswordResetAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
  type AuthState,
} from "@/app/actions/auth";

function Errors({ state }: { state: AuthState }) {
  if (!state) return null;
  return (
    <>
      <FormError message={state.error} />
      {state.message ? <Notice tone="ok">{state.message}</Notice> : null}
    </>
  );
}

export function SignInForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold">Sign in</h1>
      {notice ? <Notice>{notice}</Notice> : null}
      <input type="hidden" name="next" value={next} />
      <Field label="Email" error={state?.fields?.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required inputMode="email" />}
      </Field>
      <Field label="Password" error={state?.fields?.password}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
      </Field>
      <Errors state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        Sign in
      </Button>
      <div className="flex justify-between text-sm">
        <Link className="text-accent underline" href="/forgot-password">
          Forgot password?
        </Link>
        <Link className="text-accent underline" href={`/signup${next !== "/today" ? `?next=${encodeURIComponent(next)}` : ""}`}>
          Create account
        </Link>
      </div>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <Field label="Email" error={state?.fields?.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required inputMode="email" />}
      </Field>
      <Field label="Password" error={state?.fields?.password} hint="At least 8 characters.">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={8} />}
      </Field>
      <Field label="Confirm password" error={state?.fields?.confirm}>
        {(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}
      </Field>
      <Errors state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        Create account
      </Button>
      <p className="text-sm">
        Already have an account?{" "}
        <Link className="text-accent underline" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="text-sm text-muted">We&apos;ll email you a link to choose a new password.</p>
      <Field label="Email" error={state?.fields?.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Errors state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        Send reset link
      </Button>
      <Link className="text-sm text-accent underline" href="/login">
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <Field label="New password" error={state?.fields?.password} hint="At least 8 characters.">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={8} />}
      </Field>
      <Field label="Confirm new password" error={state?.fields?.confirm}>
        {(p) => <Input {...p} name="confirm" type="password" autoComplete="new-password" required />}
      </Field>
      <Errors state={state} />
      <Button type="submit" variant="primary" busy={pending}>
        Save password
      </Button>
    </form>
  );
}
