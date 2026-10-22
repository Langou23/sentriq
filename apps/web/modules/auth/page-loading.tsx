export function AuthPageLoading() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <p role="status" className="text-center text-sm text-muted-foreground">
        Chargement de votre espace…
        <span lang="en" className="mt-1 block">
          Loading your workspace…
        </span>
      </p>
    </main>
  );
}
