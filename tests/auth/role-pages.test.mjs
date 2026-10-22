import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

// Exercise the real server guard, replacing only framework/request integrations.
function loadTypeScript(relativePath, mocks = {}, cache = new Map()) {
  const filename = path.resolve(repositoryRoot, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;

  const module = { exports: {} };
  cache.set(filename, module);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const nativeRequire = createRequire(filename);
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier === "server-only") return {};
    if (specifier.startsWith(".")) {
      return loadTypeScript(
        path.resolve(path.dirname(filename), `${specifier}.ts`),
        mocks,
        cache,
      );
    }
    return nativeRequire(specifier);
  };
  const evaluate = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {\n${outputText}\n})`,
    { filename },
  );
  evaluate(
    module.exports,
    localRequire,
    module,
    filename,
    path.dirname(filename),
  );
  return module.exports;
}

const firstUserId = "11111111-1111-4111-8111-111111111111";
const secondUserId = "22222222-2222-4222-8222-222222222222";

function profile(overrides = {}) {
  return {
    id: firstUserId,
    badge_number: "QC-001",
    first_name: "Camille",
    last_name: "Tremblay",
    role: "agent",
    is_active: true,
    ...overrides,
  };
}

class RedirectSignal extends Error {
  constructor(location) {
    super("NEXT_REDIRECT");
    this.location = location;
  }
}

function guardHarness() {
  const requests = new AsyncLocalStorage();
  const calls = {
    connections: [],
    clients: [],
    users: [],
    profiles: [],
    redirects: [],
    events: [],
  };
  const guards = loadTypeScript("apps/web/modules/auth/server.ts", {
    "@/lib/supabase/server": {
      async createClient(options) {
        const request = requests.getStore() ?? {};
        calls.events.push("client");
        calls.clients.push({ request: request.name, options });
        if (request.clientThrows) throw request.clientThrows;
        return {
          auth: {
            async getUser() {
              calls.users.push(request.name);
              await request.onGetUser?.();
              if (request.getUserThrows) throw request.getUserThrows;
              return Object.hasOwn(request, "authReply")
                ? request.authReply
                : { data: { user: { id: firstUserId } }, error: null };
            },
          },
          from(table) {
            const query = { request: request.name, table };
            calls.profiles.push(query);
            return {
              select(columns) {
                query.columns = columns;
                return {
                  eq(column, value) {
                    query.filter = { column, value };
                    return {
                      async maybeSingle() {
                        await request.onReadProfile?.();
                        if (request.profileThrows) throw request.profileThrows;
                        return Object.hasOwn(request, "profileReply")
                          ? request.profileReply
                          : { data: profile(), error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
    "next/navigation": {
      redirect(location) {
        calls.redirects.push(location);
        throw new RedirectSignal(location);
      },
    },
    "next/server": {
      async connection() {
        const request = requests.getStore() ?? {};
        calls.connections.push(request.name);
        calls.events.push("connection");
      },
    },
  });
  return {
    calls,
    requireProfile(options = {}, expectedRole) {
      return requests.run(options, () => guards.requireProfile(expectedRole));
    },
    redirectToRoleHome(options = {}) {
      return requests.run(options, () => guards.redirectToRoleHome());
    },
  };
}

async function expectRedirect(promise, location) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RedirectSignal);
    assert.equal(error.location, location);
    return true;
  });
}

for (const role of ["agent", "supervisor", "admin"]) {
  test(`requireProfile returns the current active ${role} profile`, async () => {
    const harness = guardHarness();
    const result = await harness.requireProfile(
      { profileReply: { data: profile({ role }), error: null } },
      role,
    );
    assert.equal(result.id, firstUserId);
    assert.equal(result.badgeNumber, "QC-001");
    assert.equal(result.firstName, "Camille");
    assert.equal(result.lastName, "Tremblay");
    assert.equal(result.role, role);
    assert.equal(result.isActive, true);
    assert.equal(harness.calls.connections.length, 1);
    assert.deepEqual(harness.calls.events, ["connection", "client"]);
    assert.equal(harness.calls.clients.length, 1);
    assert.equal(harness.calls.users.length, 1);
    assert.equal(harness.calls.profiles.length, 1);
    assert.deepEqual(harness.calls.redirects, []);
    const query = harness.calls.profiles[0];
    assert.equal(query.table, "profiles");
    assert.deepEqual(
      new Set(query.columns.split(",").map((column) => column.trim())),
      new Set([
        "id",
        "badge_number",
        "first_name",
        "last_name",
        "role",
        "is_active",
      ]),
    );
    assert.deepEqual(query.filter, { column: "id", value: firstUserId });
  });
}

test("requireProfile accepts nullable names without inventing identity fields", async () => {
  const harness = guardHarness();
  const result = await harness.requireProfile({
    profileReply: {
      data: profile({ first_name: null, last_name: null }),
      error: null,
    },
  });
  assert.equal(result.firstName, null);
  assert.equal(result.lastName, null);
  assert.deepEqual(Object.keys(result).sort(), [
    "badgeNumber",
    "firstName",
    "id",
    "isActive",
    "lastName",
    "role",
  ]);
});

for (const [role, destination] of [
  ["agent", "/agent"],
  ["supervisor", "/dispatch"],
  ["admin", "/admin"],
]) {
  test(`redirectToRoleHome sends ${role} to its exact local destination`, async () => {
    const harness = guardHarness();
    await expectRedirect(
      harness.redirectToRoleHome({
        profileReply: { data: profile({ role }), error: null },
      }),
      destination,
    );
    assert.equal(harness.calls.users.length, 1);
    assert.equal(harness.calls.profiles.length, 1);
    assert.deepEqual(harness.calls.redirects, [destination]);
  });

  for (const requestedRole of ["agent", "supervisor", "admin"].filter(
    (value) => value !== role,
  )) {
    test(`${role} requesting ${requestedRole} is redirected to its own dashboard`, async () => {
      const harness = guardHarness();
      await expectRedirect(
        harness.requireProfile(
          { profileReply: { data: profile({ role }), error: null } },
          requestedRole,
        ),
        destination,
      );
      assert.deepEqual(harness.calls.redirects, [destination]);
    });
  }
}

for (const [label, options] of [
  ["missing session", { authReply: { data: { user: null }, error: null } }],
  [
    "rejected session",
    {
      authReply: {
        data: { user: null },
        error: { message: "private auth diagnostic" },
      },
    },
  ],
  [
    "user present with Auth error",
    {
      authReply: {
        data: { user: { id: firstUserId } },
        error: { message: "private auth diagnostic" },
      },
    },
  ],
  [
    "Auth request exception",
    { getUserThrows: new Error("private network diagnostic") },
  ],
  [
    "missing configuration",
    { clientThrows: new Error("private configuration diagnostic") },
  ],
  ["malformed Auth response", { authReply: null }],
]) {
  test(`requireProfile denies ${label} before reading profile data`, async () => {
    const harness = guardHarness();
    await expectRedirect(harness.requireProfile(options, "admin"), "/login");
    assert.deepEqual(harness.calls.profiles, []);
    assert.deepEqual(harness.calls.redirects, ["/login"]);
  });
}

for (const [label, options] of [
  ["missing profile", { profileReply: { data: null, error: null } }],
  [
    "inactive profile",
    { profileReply: { data: profile({ is_active: false }), error: null } },
  ],
  [
    "database error",
    {
      profileReply: {
        data: profile(),
        error: { message: "private SQL diagnostic" },
      },
    },
  ],
  [
    "database request exception",
    { profileThrows: new Error("private network diagnostic") },
  ],
  [
    "another user's profile",
    { profileReply: { data: profile({ id: secondUserId }), error: null } },
  ],
  [
    "unknown role",
    { profileReply: { data: profile({ role: "owner" }), error: null } },
  ],
  [
    "missing active flag",
    {
      profileReply: {
        data: { ...profile(), is_active: undefined },
        error: null,
      },
    },
  ],
  [
    "nonboolean active flag",
    { profileReply: { data: profile({ is_active: "true" }), error: null } },
  ],
  [
    "missing badge",
    {
      profileReply: {
        data: { ...profile(), badge_number: undefined },
        error: null,
      },
    },
  ],
  [
    "nonstring name",
    { profileReply: { data: profile({ first_name: 42 }), error: null } },
  ],
  ["malformed database response", { profileReply: null }],
]) {
  test(`requireProfile fails closed for ${label}`, async () => {
    const harness = guardHarness();
    await expectRedirect(harness.requireProfile(options), "/login");
    assert.deepEqual(harness.calls.redirects, ["/login"]);
  });
}

test("redirectToRoleHome cannot route a request without an authenticated profile", async () => {
  const harness = guardHarness();
  await expectRedirect(
    harness.redirectToRoleHome({
      authReply: { data: { user: null }, error: null },
    }),
    "/login",
  );
  assert.deepEqual(harness.calls.profiles, []);
  assert.deepEqual(harness.calls.redirects, ["/login"]);
});

test("requireProfile never reuses authorization across sequential requests", async () => {
  const harness = guardHarness();
  const admin = await harness.requireProfile(
    {
      name: "first-admin",
      profileReply: { data: profile({ role: "admin" }), error: null },
    },
    "admin",
  );
  assert.equal(admin.role, "admin");
  await expectRedirect(
    harness.requireProfile(
      {
        name: "second-agent",
        authReply: { data: { user: { id: secondUserId } }, error: null },
        profileReply: {
          data: profile({ id: secondUserId, role: "agent" }),
          error: null,
        },
      },
      "admin",
    ),
    "/agent",
  );
  await expectRedirect(
    harness.requireProfile(
      {
        name: "third-anonymous",
        authReply: { data: { user: null }, error: null },
      },
      "admin",
    ),
    "/login",
  );
  assert.deepEqual(harness.calls.users, [
    "first-admin",
    "second-agent",
    "third-anonymous",
  ]);
  assert.equal(harness.calls.clients.length, 3);
  assert.deepEqual(
    harness.calls.profiles.map((query) => query.filter.value),
    [firstUserId, secondUserId],
  );
});

test("a previously active profile is rechecked after deactivation", async () => {
  const harness = guardHarness();
  await harness.requireProfile({ name: "active" });
  await expectRedirect(
    harness.requireProfile({
      name: "now-inactive",
      profileReply: { data: profile({ is_active: false }), error: null },
    }),
    "/login",
  );
  assert.equal(harness.calls.clients.length, 2);
  assert.equal(harness.calls.users.length, 2);
  assert.equal(harness.calls.profiles.length, 2);
});

test("overlapping requests keep verified identities and profile roles isolated", async () => {
  const harness = guardHarness();
  let releaseFirst;
  let firstStarted;
  const started = new Promise((resolve) => {
    firstStarted = resolve;
  });
  const released = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = harness.requireProfile(
    {
      name: "slow-admin",
      async onGetUser() {
        firstStarted();
        await released;
      },
      profileReply: { data: profile({ role: "admin" }), error: null },
    },
    "admin",
  );
  await started;
  const second = await harness.requireProfile(
    {
      name: "fast-agent",
      authReply: { data: { user: { id: secondUserId } }, error: null },
      profileReply: {
        data: profile({ id: secondUserId, role: "agent" }),
        error: null,
      },
    },
    "agent",
  );
  releaseFirst();
  const firstResult = await first;
  assert.equal(firstResult.id, firstUserId);
  assert.equal(firstResult.role, "admin");
  assert.equal(second.id, secondUserId);
  assert.equal(second.role, "agent");
  assert.deepEqual(
    harness.calls.profiles.map((query) => [query.request, query.filter.value]),
    [
      ["fast-agent", secondUserId],
      ["slow-admin", firstUserId],
    ],
  );
  assert.deepEqual(harness.calls.redirects, []);
});
