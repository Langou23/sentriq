"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "./actions";

// Public UI entry point for the existing sign-out Server Action.
export function SignOutButton() {
  const [state, formAction, pending] = useActionState(signOut, null);

  return (
    <form action={formAction} aria-busy={pending} className="space-y-3">
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        className="h-auto min-h-11 w-full px-4 py-3 sm:w-auto"
      >
        <span className="flex flex-col">
          <span>{pending ? "Déconnexion en cours…" : "Se déconnecter"}</span>
          <span lang="en" className="text-xs font-normal text-muted-foreground">
            {pending ? "Signing out…" : "Sign out"}
          </span>
        </span>
      </Button>
      {state && (
        <div role="alert" className="text-sm text-destructive">
          <p>{state.message.fr}</p>
          <p lang="en" className="mt-1">
            {state.message.en}
          </p>
        </div>
      )}
    </form>
  );
}
