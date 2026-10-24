import "server-only";

import { Suspense } from "react";
import { AuthPageLoading } from "@/modules/auth/page-loading";
import { SignOutButton } from "@/modules/auth/sign-out-button";
import { getAgentWorkspace } from "./server";
import { TimeClock } from "./time-clock";

async function AgentHomeContent() {
  const { profile, result } = await getAgentWorkspace();
  const name =
    [profile.firstName?.trim(), profile.lastName?.trim()]
      .filter(Boolean)
      .join(" ") || profile.badgeNumber;

  return (
    <main className="min-h-svh bg-background px-4 py-6 text-foreground sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <header className="space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="space-y-3">
            <p className="text-sm font-semibold tracking-wide text-muted-foreground">
              SentriQ
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Espace agent
              <span
                lang="en"
                className="mt-1 block text-lg font-normal text-muted-foreground"
              >
                Agent workspace
              </span>
            </h1>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">
                Nom <span lang="en">/ Name</span>
              </dt>
              <dd className="mt-1 break-words font-medium">{name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                Rôle <span lang="en">/ Role</span>
              </dt>
              <dd className="mt-1 font-medium">
                Agent{" "}
                <span
                  lang="en"
                  className="ml-2 font-normal text-muted-foreground"
                >
                  Agent
                </span>
              </dd>
            </div>
          </dl>
        </header>
        <TimeClock result={result} />
        <footer>
          <SignOutButton />
        </footer>
      </div>
    </main>
  );
}

// Public server entry point; the workspace read enforces the agent role guard.
export function AgentHome() {
  return (
    <Suspense fallback={<AuthPageLoading />}>
      <AgentHomeContent />
    </Suspense>
  );
}
