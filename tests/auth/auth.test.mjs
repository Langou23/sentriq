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

// Next normally installs this global while bootstrapping its server runtime.
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { NextRequest } = require("next/server");
const nextTesting = require("next/experimental/testing/server");
const doesProxyMatch =
  nextTesting.unstable_doesProxyMatch ??
  nextTesting.unstable_doesMiddlewareMatch;

// Execute the real TypeScript sources, replacing only external request-bound APIs.
// CommonJS evaluation keeps assertions and application values in the same realm.
function loadTypeScript(relativePath, mocks = {}, cache = new Map()) {
  const filename = path.resolve(repositoryRoot, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;

  const module = { exports: {} };
  cache.set(filename, module);
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
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
      const target = path.resolve(path.dirname(filename), `${specifier}.ts`);
      return loadTypeScript(target, mocks, cache);
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

const validAuthData = {
  user: { id: "test-user" },
  session: { access_token: "test-access-token" },
};

class RedirectSignal extends Error {
  constructor(location) {
    super("NEXT_REDIRECT");
    this.location = location;
  }
}

function actionHarness(options = {}) {
  const calls = {
    clients: [],
    signIns: [],
    signOuts: [],
    profiles: [],
    commits: 0,
    clears: 0,
    events: [],
    revalidations: [],
  };
  const client = {
    auth: {
      async signInWithPassword(credentials) {
        calls.signIns.push(credentials);
        calls.events.push("signIn");
        if (options.signInThrows) throw options.signInThrows;
        return options.signInReply ?? { data: validAuthData, error: null };
      },
      async signOut(scope) {
        calls.signOuts.push(scope);
        calls.events.push("signOut");
        if (options.signOutThrows) throw options.signOutThrows;
        return options.signOutReply ?? { error: null };
      },
    },
    from(table) {
      calls.profiles.push({ table });
      return {
        select(columns) {
          calls.profiles.at(-1).columns = columns;
          return {
            eq(column, value) {
              calls.profiles.at(-1).filter = { column, value };
              return {
                async maybeSingle() {
                  calls.events.push("profile");
                  if (options.profileThrows) throw options.profileThrows;
                  return (
                    options.profileReply ?? {
                      data: { role: "agent", is_active: true },
                      error: null,
                    }
                  );
                },
              };
            },
          };
        },
      };
    },
  };
  const actions = loadTypeScript("apps/web/modules/auth/actions.ts", {
    "@/lib/supabase/server": {
      async createClient(clientOptions) {
        calls.clients.push(clientOptions);
        if (options.clientThrows) throw options.clientThrows;
        return client;
      },
      async createSignInClient() {
        calls.clients.push({ deferred: true });
        if (options.clientThrows) throw options.clientThrows;
        return {
          supabase: client,
          commitSessionCookies() {
            calls.commits += 1;
            calls.events.push("commit");
            if (options.commitThrows) throw options.commitThrows;
          },
          clearSessionCookies() {
            calls.clears += 1;
            calls.events.push("clear");
            if (options.clearThrows) throw options.clearThrows;
          },
        };
      },
    },
    "next/cache": {
      revalidatePath(...args) {
        calls.revalidations.push(args);
      },
    },
    "next/navigation": {
      redirect(location) {
        throw new RedirectSignal(location);
      },
    },
  });
  return { ...actions, calls };
}

function assertAuthError(result, code) {
  assert.equal(result.success, false);
  assert.equal(result.code, code);
  assert.equal(typeof result.message.fr, "string");
  assert.equal(typeof result.message.en, "string");
  assert.ok(result.message.fr.length > 0);
  assert.ok(result.message.en.length > 0);
  assert.notEqual(result.message.fr, result.message.en);
  assert.deepEqual(
    Object.keys(result).sort(),
    result.fieldErrors
      ? ["code", "fieldErrors", "message", "success"]
      : ["code", "message", "success"],
  );
}

function proxyHarness(options = {}) {
  const calls = { configs: 0, clients: 0, users: 0 };
  const { updateSession } = loadTypeScript("apps/web/modules/auth/proxy.ts", {
    "@/lib/supabase/config": {
      getSupabaseConfig() {
        calls.configs += 1;
        if (options.configThrows) throw options.configThrows;
        return { url: "https://supabase.example", anonKey: "test-public-key" };
      },
    },
    "@supabase/ssr": {
      createServerClient(_url, _key, clientOptions) {
        calls.clients += 1;
        return {
          auth: {
            async getUser() {
              calls.users += 1;
              await options.onVerify?.(clientOptions.cookies);
              if (options.verifyThrows) throw options.verifyThrows;
              return (
                options.reply ?? {
                  data: { user: null },
                  error: { message: "Auth session missing" },
                }
              );
            },
          },
        };
      },
    },
  });
  return { updateSession, calls };
}

function request(pathname = "/private", options) {
  return new NextRequest(new URL(pathname, "https://sentriq.example"), options);
}

function assertLoginRedirect(response, status = 307) {
  assert.equal(response.status, status);
  assert.equal(
    response.headers.get("location"),
    "https://sentriq.example/login",
  );
  assert.match(response.headers.get("cache-control"), /private/);
  assert.match(response.headers.get("cache-control"), /no-store/);
}

const { badgeNumberToEmail, validateSignIn } = loadTypeScript(
  "apps/web/modules/auth/index.ts",
);

for (const [badge, email] of [
  ["  abC-001  ", "ABC-001@sentriq.local"],
  ["00042", "00042@sentriq.local"],
  ["\tqc_73\n", "QC_73@sentriq.local"],
]) {
  test(`badge normalization preserves the identifier: ${JSON.stringify(badge)}`, () => {
    assert.equal(badgeNumberToEmail(badge), email);
  });
}

function assertBilingual(message) {
  assert.equal(typeof message.fr, "string");
  assert.equal(typeof message.en, "string");
  assert.ok(message.fr.length > 0);
  assert.ok(message.en.length > 0);
  assert.notEqual(message.fr, message.en);
}

test("Zod validation trims the badge without changing password contents", () => {
  const result = validateSignIn({
    badgeNumber: "  qc-001  ",
    password: "  password  ",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.badgeNumber.trim(), result.data.badgeNumber);
  assert.equal(result.data.badgeNumber.toUpperCase(), "QC-001");
  assert.equal(result.data.password, "  password  ");
});

test("Zod validation does not trim a nonempty whitespace password", () => {
  const result = validateSignIn({ badgeNumber: "AG001", password: " " });
  assert.equal(result.success, true);
  assert.equal(result.data.password, " ");
});

for (const [field, values] of [
  ["badgeNumber", ["", " \t ", "AG 001", "someone@example.com", null, 42]],
  ["password", ["", null, 42]],
]) {
  for (const value of values) {
    test(`Zod validation returns bilingual ${field} errors for ${JSON.stringify(value)}`, () => {
      const result = validateSignIn({
        badgeNumber: "AG001",
        password: "password",
        [field]: value,
      });
      assert.equal(result.success, false);
      assertBilingual(result.fieldErrors[field]);
      assert.equal(Object.hasOwn(result, "data"), false);
    });
  }
}

for (const input of [null, undefined, "invalid", [], {}, { password: "" }]) {
  test(`Zod validation safely rejects malformed input ${JSON.stringify(input)}`, () => {
    const result = validateSignIn(input);
    assert.equal(result.success, false);
    assertBilingual(result.fieldErrors.badgeNumber);
    assertBilingual(result.fieldErrors.password);
  });
}

for (const [label, badge, password] of [
  ["empty badge", "", "password"],
  ["blank badge", " \t ", "password"],
  ["email instead of badge", "someone@example.com", "password"],
  ["internal whitespace", "AG 001", "password"],
  ["embedded newline", "AG\n001", "password"],
  ["empty password", "AG001", ""],
  ["non-string badge", { badge: "AG001" }, "password"],
  ["null badge", null, "password"],
  ["non-string password", "AG001", 12345],
  ["undefined password", "AG001", undefined],
]) {
  test(`signIn rejects ${label} before creating a client`, async () => {
    const harness = actionHarness();
    assertAuthError(await harness.signIn(badge, password), "invalid_input");
    assert.deepEqual(harness.calls.clients, []);
    assert.deepEqual(harness.calls.revalidations, []);
  });
}

test("signIn normalizes the badge, preserves password whitespace and redirects", async () => {
  const harness = actionHarness();
  await assert.rejects(
    harness.signIn("  qc-001  ", "  password  "),
    (error) => {
      assert.ok(error instanceof RedirectSignal);
      assert.equal(error.location, "/agent");
      return true;
    },
  );
  assert.deepEqual(harness.calls.clients, [{ deferred: true }]);
  assert.deepEqual(harness.calls.signIns, [
    { email: "QC-001@sentriq.local", password: "  password  " },
  ]);
  assert.deepEqual(harness.calls.revalidations, [["/", "layout"]]);
  assert.deepEqual(harness.calls.profiles, [
    {
      table: "profiles",
      columns: "role,is_active",
      filter: { column: "id", value: validAuthData.user.id },
    },
  ]);
  assert.deepEqual(harness.calls.events, ["signIn", "profile", "commit"]);
  assert.equal(harness.calls.commits, 1);
  assert.equal(harness.calls.clears, 0);
});

for (const [role, target] of [
  ["agent", "/agent"],
  ["supervisor", "/dispatch"],
  ["admin", "/admin"],
]) {
  test(`signIn publishes the session only after validating an active ${role} profile`, async () => {
    const harness = actionHarness({
      profileReply: { data: { role, is_active: true }, error: null },
    });
    await assert.rejects(harness.signIn("AG001", "password"), (error) => {
      assert.ok(error instanceof RedirectSignal);
      assert.equal(error.location, target);
      return true;
    });
    assert.deepEqual(harness.calls.events, ["signIn", "profile", "commit"]);
    assert.equal(harness.calls.commits, 1);
    assert.equal(harness.calls.clears, 0);
    assert.deepEqual(harness.calls.signOuts, []);
    assert.deepEqual(harness.calls.revalidations, [["/", "layout"]]);
  });
}

for (const [label, profile] of [
  ["missing", null],
  ["inactive agent", { role: "agent", is_active: false }],
  ["inactive supervisor", { role: "supervisor", is_active: false }],
  ["inactive admin", { role: "admin", is_active: false }],
]) {
  test(`signIn immediately signs out a ${label} profile without publishing session cookies`, async () => {
    const harness = actionHarness({
      profileReply: { data: profile, error: null },
    });
    const result = await harness.signIn("AG001", "password");
    assertAuthError(result, "account_disabled");
    assert.deepEqual(result.message, {
      fr: "Compte désactivé, contactez votre superviseur.",
      en: "Account disabled. Contact your supervisor.",
    });
    assert.deepEqual(harness.calls.signOuts, [{ scope: "local" }]);
    assert.deepEqual(harness.calls.events, [
      "signIn",
      "profile",
      "signOut",
      "clear",
    ]);
    assert.equal(harness.calls.commits, 0);
    assert.equal(harness.calls.clears, 1);
    assert.deepEqual(harness.calls.revalidations, []);
  });
}

for (const [label, profileReply] of [
  [
    "database error",
    { data: null, error: { message: "private SQL diagnostic" } },
  ],
  ["unknown role", { data: { role: "owner", is_active: true }, error: null }],
  ["missing role", { data: { is_active: true }, error: null }],
  ["missing active flag", { data: { role: "agent" }, error: null }],
  [
    "nonboolean active flag",
    { data: { role: "admin", is_active: "true" }, error: null },
  ],
]) {
  test(`signIn fails closed and clears the session for ${label}`, async () => {
    const harness = actionHarness({ profileReply });
    const result = await harness.signIn("AG001", "password");
    assertAuthError(result, "service_unavailable");
    assert.doesNotMatch(JSON.stringify(result), /SQL|owner|AG001|password/);
    assert.deepEqual(harness.calls.signOuts, [{ scope: "local" }]);
    assert.equal(harness.calls.commits, 0);
    assert.equal(harness.calls.clears, 1);
    assert.deepEqual(harness.calls.revalidations, []);
  });
}

test("signIn clears staged cookies when the profile lookup throws", async () => {
  const harness = actionHarness({
    profileThrows: new Error("private diagnostic"),
  });
  const result = await harness.signIn("AG001", "password");
  assertAuthError(result, "service_unavailable");
  assert.doesNotMatch(JSON.stringify(result), /private diagnostic/);
  assert.deepEqual(harness.calls.signOuts, [{ scope: "local" }]);
  assert.equal(harness.calls.commits, 0);
  assert.equal(harness.calls.clears, 1);
  assert.deepEqual(harness.calls.revalidations, []);
});

for (const failure of [
  { signOutReply: { error: { message: "private logout diagnostic" } } },
  { signOutThrows: new Error("private logout diagnostic") },
]) {
  test(`rejected profile cookie cleanup survives ${Object.keys(failure)[0]}`, async () => {
    const harness = actionHarness({
      ...failure,
      profileReply: { data: { role: "agent", is_active: false }, error: null },
    });
    const result = await harness.signIn("AG001", "password");
    assertAuthError(result, "account_disabled");
    assert.equal(harness.calls.commits, 0);
    assert.equal(harness.calls.clears, 1);
    assert.deepEqual(harness.calls.revalidations, []);
    assert.doesNotMatch(JSON.stringify(result), /private logout diagnostic/);
  });
}

test("rejected profile reports service failure if browser cookies cannot be cleared", async () => {
  const harness = actionHarness({
    profileReply: { data: null, error: null },
    clearThrows: new Error("private cookie persistence diagnostic"),
  });
  const result = await harness.signIn("AG001", "password");
  assertAuthError(result, "service_unavailable");
  assert.equal(harness.calls.commits, 0);
  assert.equal(harness.calls.clears, 1);
  assert.deepEqual(harness.calls.signOuts, [{ scope: "local" }]);
  assert.deepEqual(harness.calls.revalidations, []);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private cookie persistence diagnostic/,
  );
});

test("signIn does not redirect when committing session cookies fails", async () => {
  const harness = actionHarness({
    commitThrows: new Error("Cookie store failure"),
  });
  const result = await harness.signIn("AG001", "password");
  assertAuthError(result, "service_unavailable");
  assert.equal(harness.calls.commits, 1);
  assert.equal(harness.calls.clears, 1);
  assert.deepEqual(harness.calls.signOuts, [{ scope: "local" }]);
  assert.deepEqual(harness.calls.revalidations, []);
  assert.doesNotMatch(JSON.stringify(result), /Cookie store failure/);
});

for (const status of [400, 401, 422, 429, 500, undefined]) {
  test(`signIn maps Auth status ${status} to a safe bilingual error`, async () => {
    const harness = actionHarness({
      signInReply: {
        data: { user: null, session: null },
        error: { status, message: "private upstream diagnostic" },
      },
    });
    const result = await harness.signIn("AG001", "test-secret-password-value");
    assertAuthError(
      result,
      !status || status === 429 || status >= 500
        ? "service_unavailable"
        : "invalid_credentials",
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /upstream|test-secret-password-value|AG001/,
    );
    assert.deepEqual(harness.calls.revalidations, []);
    assert.equal(harness.calls.commits, 0);
    assert.deepEqual(harness.calls.profiles, []);
    if (status && status < 429) {
      assert.deepEqual(result.message, {
        fr: "Matricule ou mot de passe invalide.",
        en: "Invalid badge number or password.",
      });
    }
  });
}

for (const data of [
  { user: null, session: validAuthData.session },
  { user: validAuthData.user, session: null },
]) {
  test(`signIn rejects a response missing ${data.user ? "session" : "user"}`, async () => {
    const harness = actionHarness({ signInReply: { data, error: null } });
    assertAuthError(
      await harness.signIn("AG001", "password"),
      "invalid_credentials",
    );
    assert.deepEqual(harness.calls.revalidations, []);
  });
}

for (const failure of ["clientThrows", "signInThrows"]) {
  test(`signIn safely reports ${failure}`, async () => {
    const harness = actionHarness({
      [failure]: new Error("private diagnostic"),
    });
    const result = await harness.signIn("AG001", "password");
    assertAuthError(result, "service_unavailable");
    assert.doesNotMatch(JSON.stringify(result), /private diagnostic/);
    assert.deepEqual(harness.calls.revalidations, []);
  });
}

test("signInFromForm validates both empty fields without leaking submitted values", async () => {
  const harness = actionHarness();
  const formData = new FormData();
  formData.set("badgeNumber", " \t ");
  formData.set("password", "");
  const result = await harness.signInFromForm(null, formData);
  assertAuthError(result, "invalid_input");
  assertBilingual(result.fieldErrors.badgeNumber);
  assertBilingual(result.fieldErrors.password);
  assert.deepEqual(harness.calls.clients, []);
  assert.equal(Object.hasOwn(result, "password"), false);
  assert.equal(Object.hasOwn(result, "badgeNumber"), false);
});

test("signInFromForm forwards the original password and redirects according to profile role", async () => {
  const harness = actionHarness({
    profileReply: {
      data: { role: "supervisor", is_active: true },
      error: null,
    },
  });
  const formData = new FormData();
  formData.set("badgeNumber", "  qc-001  ");
  formData.set("password", "  preserve password  ");
  await assert.rejects(harness.signInFromForm(null, formData), (error) => {
    assert.ok(error instanceof RedirectSignal);
    assert.equal(error.location, "/dispatch");
    return true;
  });
  assert.deepEqual(harness.calls.signIns, [
    { email: "QC-001@sentriq.local", password: "  preserve password  " },
  ]);
  assert.equal(harness.calls.commits, 1);
});

test("signInFromForm returns generic authentication failures without password or badge contents", async () => {
  const harness = actionHarness({
    signInReply: {
      data: { user: null, session: null },
      error: { status: 400, message: "User not found" },
    },
  });
  const formData = new FormData();
  formData.set("badgeNumber", "QC-001");
  formData.set("password", "private-password-value");
  const result = await harness.signInFromForm(null, formData);
  assertAuthError(result, "invalid_credentials");
  assert.doesNotMatch(
    JSON.stringify(result),
    /User not found|QC-001|private-password-value/,
  );
  assert.equal(Object.hasOwn(result, "fieldErrors"), false);
  assert.equal(harness.calls.commits, 0);
});

for (const formData of [null, undefined, {}, "not form data", new Map()]) {
  test(`signInFromForm safely handles malformed FormData ${Object.prototype.toString.call(formData)}`, async () => {
    const harness = actionHarness();
    const result = await harness.signInFromForm(null, formData);
    assertAuthError(result, "invalid_input");
    assert.deepEqual(harness.calls.clients, []);
  });
}

for (const field of ["badgeNumber", "password"]) {
  test(`signInFromForm rejects a file supplied as ${field}`, async () => {
    const harness = actionHarness();
    const formData = new FormData();
    formData.set("badgeNumber", "AG001");
    formData.set("password", "password");
    formData.set(field, new Blob(["private upload content"]), "unexpected.txt");
    const result = await harness.signInFromForm(null, formData);
    assertAuthError(result, "invalid_input");
    assertBilingual(result.fieldErrors[field]);
    assert.deepEqual(harness.calls.clients, []);
    assert.doesNotMatch(
      JSON.stringify(result),
      /private upload content|unexpected.txt/,
    );
  });
}

test("signOut revokes only the current session and redirects outside its catch", async () => {
  const harness = actionHarness();
  await assert.rejects(harness.signOut(), (error) => {
    assert.ok(error instanceof RedirectSignal);
    assert.equal(error.location, "/login");
    return true;
  });
  assert.deepEqual(harness.calls.clients, [{ requireCookieWrites: true }]);
  assert.deepEqual(harness.calls.signOuts, [{ scope: "local" }]);
  assert.deepEqual(harness.calls.revalidations, [["/", "layout"]]);
});

for (const failure of [
  { signOutReply: { error: { message: "private diagnostic" } } },
  { signOutThrows: new Error("private diagnostic") },
  { clientThrows: new Error("private diagnostic") },
]) {
  test(`signOut safely handles ${Object.keys(failure)[0]}`, async () => {
    const harness = actionHarness(failure);
    const result = await harness.signOut();
    assertAuthError(result, "service_unavailable");
    assert.doesNotMatch(JSON.stringify(result), /private diagnostic/);
    assert.deepEqual(harness.calls.revalidations, []);
  });
}

test("the public health route bypasses authentication configuration entirely", async () => {
  const harness = proxyHarness({ configThrows: new Error("no configuration") });
  const response = await harness.updateSession(request("/health"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.deepEqual(harness.calls, { configs: 0, clients: 0, users: 0 });
});

for (const pathname of ["/login", "/login?next=https://attacker.example"]) {
  for (const [label, options] of [
    ["no session", {}],
    [
      "invalid session",
      { reply: { data: { user: null }, error: new Error("Invalid JWT") } },
    ],
    ["Auth outage", { verifyThrows: new Error("offline") }],
    ["missing configuration", { configThrows: new Error("no configuration") }],
  ]) {
    test(`public login ${pathname} remains reachable with ${label}`, async () => {
      const harness = proxyHarness(options);
      const response = await harness.updateSession(request(pathname));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.equal(response.headers.get("location"), null);
      assert.match(response.headers.get("cache-control"), /private.*no-store/);
      assert.equal(harness.calls.configs, 1);
      assert.equal(harness.calls.users, options.configThrows ? 0 : 1);
    });
  }
}

test("public login refreshes cookies for Server Components and the browser", async () => {
  const harness = proxyHarness({
    reply: { data: { user: { id: "test-user" } }, error: null },
    onVerify(cookies) {
      cookies.setAll(
        [{ name: "sb-session", value: "refreshed", options: { path: "/" } }],
        {
          "Cache-Control": "private, no-store",
          Expires: "0",
          Pragma: "no-cache",
        },
      );
    },
  });
  const nextRequest = request("/login", {
    headers: { cookie: "sb-session=expired" },
  });
  const response = await harness.updateSession(nextRequest);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(harness.calls.users, 1);
  assert.equal(nextRequest.cookies.get("sb-session").value, "refreshed");
  assert.equal(response.cookies.get("sb-session").value, "refreshed");
  assert.match(
    response.headers.get("x-middleware-request-cookie"),
    /sb-session=refreshed/,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("public login persists rejected-session cookie cleanup without redirecting", async () => {
  const harness = proxyHarness({
    onVerify(cookies) {
      cookies.setAll(
        [{ name: "sb-session", value: "", options: { path: "/", maxAge: 0 } }],
        { "Cache-Control": "private, no-store" },
      );
    },
  });
  const response = await harness.updateSession(request("/login"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.cookies.get("sb-session").value, "");
  assert.equal(response.cookies.get("sb-session").maxAge, 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

for (const pathname of [
  "/",
  "/login-other",
  "/login/private",
  "/health/private",
  "/api/export.csv",
]) {
  test(`protected route ${pathname} redirects without a session`, async () => {
    const harness = proxyHarness();
    assertLoginRedirect(await harness.updateSession(request(pathname)));
    assert.equal(harness.calls.users, 1);
  });
}

for (const [label, options] of [
  ["forged cookie", { headers: { cookie: "sb-session=forged" } }],
  ["expired cookie", { headers: { cookie: "sb-session=expired" } }],
]) {
  test(`${label} is denied when Auth rejects it`, async () => {
    const harness = proxyHarness({
      reply: { data: { user: null }, error: { message: "Invalid JWT" } },
    });
    assertLoginRedirect(
      await harness.updateSession(request("/private", options)),
    );
    assert.equal(harness.calls.users, 1);
  });
}

for (const [label, options] of [
  [
    "Auth error despite a user",
    {
      reply: {
        data: { user: { id: "test-user" } },
        error: new Error("rejected"),
      },
    },
  ],
  ["empty Auth user", { reply: { data: { user: null }, error: null } }],
  ["Auth outage", { verifyThrows: new Error("offline") }],
  ["missing configuration", { configThrows: new Error("not configured") }],
]) {
  test(`proxy fails closed for ${label}`, async () => {
    const harness = proxyHarness(options);
    assertLoginRedirect(await harness.updateSession(request()));
  });
}

test("a remotely verified user can access a protected route without cached responses", async () => {
  const harness = proxyHarness({
    reply: { data: { user: { id: "test-user" } }, error: null },
  });
  const response = await harness.updateSession(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(harness.calls.users, 1);
});

test("refresh propagates cookies to the forwarded request and final response", async () => {
  const harness = proxyHarness({
    reply: { data: { user: { id: "test-user" } }, error: null },
    onVerify(cookies) {
      assert.deepEqual(cookies.getAll(), [
        { name: "sb-session", value: "old" },
      ]);
      cookies.setAll(
        [
          {
            name: "sb-session",
            value: "refreshed",
            options: { path: "/", sameSite: "lax" },
          },
        ],
        {
          "Cache-Control": "private, no-store",
          Expires: "0",
          Pragma: "no-cache",
        },
      );
      cookies.setAll(
        [
          {
            name: "sb-session.1",
            value: "second-chunk",
            options: { path: "/" },
          },
        ],
        {},
      );
    },
  });
  const nextRequest = request("/private", {
    headers: { cookie: "sb-session=old" },
  });
  const response = await harness.updateSession(nextRequest);
  assert.equal(nextRequest.cookies.get("sb-session").value, "refreshed");
  assert.equal(response.cookies.get("sb-session").value, "refreshed");
  assert.equal(response.cookies.get("sb-session").sameSite, "lax");
  assert.equal(response.cookies.get("sb-session.1").value, "second-chunk");
  assert.match(
    response.headers.get("x-middleware-request-cookie"),
    /sb-session=refreshed/,
  );
  assert.match(
    response.headers.get("x-middleware-request-cookie"),
    /sb-session\.1=second-chunk/,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("expires"), "0");
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("redirects preserve the final deletion cookie and first refresh cache headers", async () => {
  const harness = proxyHarness({
    onVerify(cookies) {
      cookies.setAll(
        [{ name: "sb-session", value: "intermediate", options: { path: "/" } }],
        {
          "Cache-Control": "private, no-store",
          Expires: "0",
          Pragma: "no-cache",
        },
      );
      cookies.setAll(
        [{ name: "sb-session", value: "", options: { path: "/", maxAge: 0 } }],
        {},
      );
    },
  });
  const response = await harness.updateSession(
    request("/private?secret=discard-me"),
  );
  assertLoginRedirect(response);
  assert.equal(response.cookies.get("sb-session").value, "");
  assert.equal(response.cookies.get("sb-session").maxAge, 0);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
});

for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
  test(`unauthenticated ${method} redirects without replaying a write to /login`, async () => {
    const harness = proxyHarness();
    assertLoginRedirect(
      await harness.updateSession(request("/private", { method })),
      method === "GET" || method === "HEAD" ? 307 : 303,
    );
  });
}

const { config: proxyConfig } = loadTypeScript("apps/web/proxy.ts", {
  "@/modules/auth/proxy": { updateSession() {} },
});

for (const pathname of [
  "/_next/static/chunks/main.js",
  "/_next/image?url=%2Ficons%2Ficon-192.png&w=128&q=75",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/favicon.ico",
  "/manifest.webmanifest",
]) {
  test(`actual Next matcher exempts public asset ${pathname}`, () => {
    assert.equal(
      doesProxyMatch({
        config: proxyConfig,
        url: `https://sentriq.example${pathname}`,
      }),
      false,
    );
  });
}

for (const pathname of [
  "/",
  "/login",
  "/health",
  "/api/incidents/export.csv",
  "/private/report.svg",
  "/icons-private",
  "/_next/static-other",
  "/_next/image-private",
  "/favicon.ico/private",
  "/manifest.webmanifest/private",
]) {
  test(`actual Next matcher invokes the proxy for ${pathname}`, () => {
    assert.equal(
      doesProxyMatch({
        config: proxyConfig,
        url: `https://sentriq.example${pathname}`,
      }),
      true,
    );
  });
}

function serverClientHarness({
  writesFail = false,
  existingCookies = [{ name: "existing", value: "cookie" }],
} = {}) {
  const writes = [];
  let adapter;
  const { createClient, createSignInClient } = loadTypeScript(
    "apps/web/lib/supabase/server.ts",
    {
      "./config": {
        getSupabaseConfig() {
          return {
            url: "https://supabase.example",
            anonKey: "test-public-key",
          };
        },
      },
      "next/headers": {
        async cookies() {
          return {
            getAll: () => existingCookies,
            set(name, value, options) {
              if (writesFail) throw new Error("Cookies cannot be modified");
              writes.push({ name, value, options });
            },
          };
        },
      },
      "@supabase/ssr": {
        createServerClient(_url, _key, options) {
          adapter = options.cookies;
          return { marker: "test-client" };
        },
      },
    },
  );
  return {
    createClient,
    createSignInClient,
    writes,
    get adapter() {
      return adapter;
    },
  };
}

test("the server factory persists action cookies without changing their options", async () => {
  const harness = serverClientHarness();
  await harness.createClient({ requireCookieWrites: true });
  assert.deepEqual(harness.adapter.getAll(), [
    { name: "existing", value: "cookie" },
  ]);
  harness.adapter.setAll([
    { name: "session", value: "new", options: { path: "/", sameSite: "lax" } },
  ]);
  assert.deepEqual(harness.writes, [
    { name: "session", value: "new", options: { path: "/", sameSite: "lax" } },
  ]);
});

test("Server Actions receive cookie-write failures rather than reporting success", async () => {
  const harness = serverClientHarness({ writesFail: true });
  await harness.createClient({ requireCookieWrites: true });
  assert.throws(
    () =>
      harness.adapter.setAll([{ name: "session", value: "new", options: {} }]),
    /Cookies cannot be modified/,
  );
});

test("the default server factory tolerates a read-only Server Component cookie store", async () => {
  const harness = serverClientHarness({ writesFail: true });
  await harness.createClient();
  assert.doesNotThrow(() =>
    harness.adapter.setAll([{ name: "session", value: "new", options: {} }]),
  );
});

test("the sign-in factory defers browser session cookies until profile approval", async () => {
  const harness = serverClientHarness();
  const context = await harness.createSignInClient();
  assert.equal(context.supabase.marker, "test-client");
  harness.adapter.setAll([
    {
      name: "sb-supabase-auth-token",
      value: "new-session",
      options: { path: "/", sameSite: "lax", secure: true },
    },
  ]);
  assert.deepEqual(harness.writes, []);
  assert.ok(
    harness.adapter
      .getAll()
      .some(
        (cookie) =>
          cookie.name === "sb-supabase-auth-token" &&
          cookie.value === "new-session",
      ),
  );
  await context.commitSessionCookies();
  assert.deepEqual(harness.writes, [
    {
      name: "sb-supabase-auth-token",
      value: "new-session",
      options: { path: "/", sameSite: "lax", secure: true },
    },
  ]);
});

test("the sign-in factory commits only the latest staged cookie value", async () => {
  const harness = serverClientHarness();
  const context = await harness.createSignInClient();
  harness.adapter.setAll([
    {
      name: "sb-supabase-auth-token",
      value: "old-stage",
      options: { path: "/" },
    },
  ]);
  harness.adapter.setAll([
    {
      name: "sb-supabase-auth-token",
      value: "final-stage",
      options: { path: "/", httpOnly: true },
    },
  ]);
  assert.deepEqual(harness.writes, []);
  await context.commitSessionCookies();
  assert.deepEqual(harness.writes, [
    {
      name: "sb-supabase-auth-token",
      value: "final-stage",
      options: { path: "/", httpOnly: true },
    },
  ]);
});

test("the sign-in factory removes rejected session chunks without clearing unrelated cookies", async () => {
  const harness = serverClientHarness({
    existingCookies: [
      { name: "sb-supabase-auth-token.0", value: "existing-first" },
      { name: "sb-supabase-auth-token.1", value: "existing-second" },
      { name: "sb-other-auth-token", value: "other-project" },
      { name: "language", value: "fr" },
    ],
  });
  const context = await harness.createSignInClient();
  harness.adapter.setAll([
    {
      name: "sb-supabase-auth-token.0",
      value: "rejected-first",
      options: { path: "/" },
    },
    {
      name: "sb-supabase-auth-token.2",
      value: "rejected-third",
      options: { path: "/" },
    },
  ]);
  assert.deepEqual(harness.writes, []);
  await context.clearSessionCookies();
  const clearedNames = new Set(harness.writes.map((cookie) => cookie.name));
  for (const name of [
    "sb-supabase-auth-token.0",
    "sb-supabase-auth-token.1",
    "sb-supabase-auth-token.2",
  ]) {
    assert.equal(clearedNames.has(name), true);
  }
  assert.equal(clearedNames.has("sb-other-auth-token"), false);
  assert.equal(clearedNames.has("language"), false);
  assert.ok(
    harness.writes.every(
      (cookie) => cookie.value === "" && cookie.options.maxAge === 0,
    ),
  );
  await context.commitSessionCookies();
  assert.ok(harness.writes.every((cookie) => cookie.value === ""));
});

test("the sign-in factory propagates cookie commit failures", async () => {
  const harness = serverClientHarness({ writesFail: true });
  const context = await harness.createSignInClient();
  harness.adapter.setAll([
    {
      name: "sb-supabase-auth-token",
      value: "session",
      options: { path: "/" },
    },
  ]);
  await assert.rejects(
    async () => context.commitSessionCookies(),
    /Cookies cannot be modified/,
  );
});

test("failed browser-cookie cleanup still discards staged tokens permanently", async () => {
  const harness = serverClientHarness({ writesFail: true });
  const context = await harness.createSignInClient();
  harness.adapter.setAll([
    {
      name: "sb-supabase-auth-token",
      value: "rejected-session",
      options: { path: "/" },
    },
  ]);
  await assert.rejects(
    async () => context.clearSessionCookies(),
    /Cookies cannot be modified/,
  );
  assert.ok(
    harness.adapter
      .getAll()
      .every((cookie) => cookie.value !== "rejected-session"),
  );
  await assert.doesNotReject(async () => context.commitSessionCookies());
  assert.deepEqual(harness.writes, []);
});
