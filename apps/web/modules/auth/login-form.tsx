"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { signInFromForm } from "./actions";
import type { AuthMessage } from "./types";

function MessageText({ message }: { message: AuthMessage }) {
  return (
    <>
      <span className="block">{message.fr}</span>
      <span lang="en" className="mt-1 block text-sm">
        {message.en}
      </span>
    </>
  );
}

// Public UI entry point; authentication and profile checks stay in Server Actions.
export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    signInFromForm,
    null,
    "/login",
  );
  const [badgeNumber, setBadgeNumber] = useState("");
  const fieldErrors = state?.fieldErrors;
  const inputClassName =
    "h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60 aria-invalid:border-destructive";

  return (
    <form
      action={formAction}
      noValidate
      aria-busy={pending}
      className="space-y-6"
    >
      <div className="space-y-2">
        <label htmlFor="badgeNumber" className="block text-sm font-medium">
          Matricule
          <span lang="en" className="ml-2 font-normal text-muted-foreground">
            Badge number
          </span>
        </label>
        <input
          id="badgeNumber"
          name="badgeNumber"
          type="text"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          required
          disabled={pending}
          value={badgeNumber}
          onChange={(event) => setBadgeNumber(event.target.value)}
          aria-invalid={Boolean(fieldErrors?.badgeNumber)}
          aria-describedby={
            fieldErrors?.badgeNumber ? "badgeNumber-error" : undefined
          }
          className={inputClassName}
        />
        {fieldErrors?.badgeNumber && (
          <p id="badgeNumber-error" className="text-sm text-destructive">
            <MessageText message={fieldErrors.badgeNumber} />
          </p>
        )}
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium">
          Mot de passe
          <span lang="en" className="ml-2 font-normal text-muted-foreground">
            Password
          </span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          aria-invalid={Boolean(fieldErrors?.password)}
          aria-describedby={
            fieldErrors?.password ? "password-error" : undefined
          }
          className={inputClassName}
        />
        {fieldErrors?.password && (
          <p id="password-error" className="text-sm text-destructive">
            <MessageText message={fieldErrors.password} />
          </p>
        )}
      </div>
      {state && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <MessageText message={state.message} />
        </div>
      )}
      <Button
        type="submit"
        disabled={pending}
        className="h-auto min-h-11 w-full py-3"
      >
        <span className="flex flex-col">
          <span>{pending ? "Connexion en cours…" : "Se connecter"}</span>
          <span lang="en" className="text-xs font-normal opacity-80">
            {pending ? "Signing in…" : "Sign in"}
          </span>
        </span>
      </Button>
    </form>
  );
}
