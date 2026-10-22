import type { Metadata } from "next";
import { LoginForm } from "@/modules/auth/login-form";

export const metadata: Metadata = { title: "Connexion / Sign in — SentriQ" };

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <section
        aria-labelledby="login-title"
        className="w-full max-w-sm space-y-8 rounded-xl border bg-card p-6 shadow-sm sm:p-8"
      >
        <header className="space-y-3">
          <p className="text-sm font-semibold tracking-wide text-muted-foreground">
            SentriQ
          </p>
          <h1
            id="login-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Connexion
            <span
              lang="en"
              className="mt-1 block text-lg font-normal text-muted-foreground"
            >
              Sign in
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Connectez-vous avec votre matricule.
            <span lang="en" className="mt-1 block">
              Sign in with your badge number.
            </span>
          </p>
        </header>
        <LoginForm />
      </section>
    </main>
  );
}
