import "server-only";

import { Suspense } from "react";
import { AuthPageLoading } from "./page-loading";
import { requireProfile } from "./server";
import { SignOutButton } from "./sign-out-button";
import type { AuthMessage, UserRole } from "./types";

const roleLabels: Record<UserRole, AuthMessage> = {
  agent: { fr: "Agent", en: "Agent" },
  supervisor: { fr: "Superviseur", en: "Supervisor" },
  admin: { fr: "Administrateur", en: "Administrator" },
};

const pageTitles: Record<UserRole, AuthMessage> = {
  agent: { fr: "Espace agent", en: "Agent workspace" },
  supervisor: { fr: "Tableau dispatch", en: "Dispatch dashboard" },
  admin: { fr: "Administration", en: "Administration" },
};

async function RoleHomeContent({ role }: { role: UserRole }) {
  const profile = await requireProfile(role);
  const name =
    [profile.firstName?.trim(), profile.lastName?.trim()]
      .filter(Boolean)
      .join(" ") || profile.badgeNumber;
  const title = pageTitles[profile.role];
  const roleLabel = roleLabels[profile.role];

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <section
        aria-labelledby="workspace-title"
        className="w-full max-w-xl space-y-8 rounded-xl border bg-card p-6 shadow-sm sm:p-8"
      >
        <header className="space-y-3">
          <p className="text-sm font-semibold tracking-wide text-muted-foreground">
            SentriQ
          </p>
          <h1
            id="workspace-title"
            className="text-2xl font-semibold tracking-tight"
          >
            {title.fr}
            <span
              lang="en"
              className="mt-1 block text-lg font-normal text-muted-foreground"
            >
              {title.en}
            </span>
          </h1>
        </header>
        <dl className="space-y-5">
          <div>
            <dt className="text-sm text-muted-foreground">
              Nom <span lang="en">/ Name</span>
            </dt>
            <dd className="mt-1 break-words text-lg font-medium">{name}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Rôle <span lang="en">/ Role</span>
            </dt>
            <dd className="mt-1 font-medium">
              {roleLabel.fr}
              <span
                lang="en"
                className="ml-2 font-normal text-muted-foreground"
              >
                {roleLabel.en}
              </span>
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          Votre espace est en préparation.
          <span lang="en" className="mt-1 block">
            Your workspace is being prepared.
          </span>
        </p>
        <SignOutButton />
      </section>
    </main>
  );
}

// Public, server-rendered placeholder. No user data renders before the guard.
export function RoleHome({ role }: { role: UserRole }) {
  return (
    <Suspense fallback={<AuthPageLoading />}>
      <RoleHomeContent role={role} />
    </Suspense>
  );
}
