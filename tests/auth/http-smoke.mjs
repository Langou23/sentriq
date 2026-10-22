import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
const appDirectory = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3000");

async function probe(pathname, options = {}) {
  return fetch(new URL(pathname, origin), {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
}

async function expectLoginRedirect(pathname, options = {}) {
  const response = await probe(pathname, options);
  const expectedStatus = options.method === "POST" ? 303 : 307;
  assert.equal(response.status, expectedStatus, `Protected path: ${pathname}`);
  const location = response.headers.get("location");
  assert.ok(location, `Missing login redirect for ${pathname}`);
  assert.equal(new URL(location, origin).href, new URL("/login", origin).href);
  assert.ok(response.headers.get("cache-control")?.includes("no-store"));
  console.log(
    `${options.method ?? "GET"} ${pathname}: ${response.status} → /login`,
  );
}

try {
  for (const pathname of [
    "/",
    "/__auth_smoke_private__",
    "/health/private",
    "/login-other",
    "/api/__auth_smoke_private__.csv",
    "/__auth_smoke_private__.svg",
    "/?next=https://example.invalid",
  ]) {
    await expectLoginRedirect(pathname);
  }
  await expectLoginRedirect("/__auth_smoke_private__", { method: "POST" });

  const login = await probe("/login");
  assert.ok([200, 404].includes(login.status), "/login must remain public");
  assert.equal(login.headers.get("location"), null);
  const loginHtml = await login.text();
  console.log(`GET /login: ${login.status}, no redirect loop`);

  const health = await probe("/health");
  assert.equal(
    health.status,
    200,
    "The configured Supabase health probe must pass",
  );
  assert.ok((await health.text()).includes("Supabase : connecté"));
  console.log("GET /health: 200, Supabase connected");

  for (const pathname of [
    "/icons/icon.svg",
    "/icons/icon-192.png",
    "/manifest.webmanifest",
  ]) {
    const asset = await probe(pathname);
    assert.equal(asset.status, 200, `Public asset: ${pathname}`);
    assert.equal(asset.headers.get("location"), null);
    console.log(`GET ${pathname}: 200`);
  }

  const staticAsset = loginHtml.match(
    /(?:src|href)="([^\"]*\/_next\/static\/[^\"]+)"/,
  );
  assert.ok(
    staticAsset,
    "Next.js must expose a real static asset in the login response",
  );
  const assetResponse = await probe(staticAsset[1]);
  assert.equal(assetResponse.status, 200);
  console.log("GET /_next/static/…: 200");

  // Only the public URL is used to derive the SDK's cookie name; print no config.
  loadEnvConfig(appDirectory, false, { info() {}, error() {} });
  assert.ok(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "Supabase URL is required for the forged-cookie probe",
  );
  const projectRef = new URL(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).hostname.split(".")[0];
  const fakeSession = {
    access_token: "deliberately-invalid-access-token",
    refresh_token: "deliberately-invalid-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { id: randomUUID() },
  };
  const forgedValue = `base64-${Buffer.from(JSON.stringify(fakeSession)).toString("base64url")}`;
  await expectLoginRedirect("/__auth_smoke_private__", {
    headers: { cookie: `sb-${projectRef}-auth-token=${forgedValue}` },
  });
  console.log("Forged session refused; no account or profile was created.");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "HTTP verification failed",
  );
  process.exitCode = 1;
}
