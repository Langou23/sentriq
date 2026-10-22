import assert from "node:assert/strict";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3101");
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname),
  "Run this check only against the isolated local fixture server",
);

function decodeEntities(value) {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/giu,
    (_, entity) => {
      if (entity.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      }
      return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }[
        entity.toLowerCase()
      ];
    },
  );
}

function attributes(element) {
  const result = new Map();
  const pattern = /([\w:$.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu;
  for (const match of element.matchAll(pattern)) {
    result.set(
      match[1].toLowerCase(),
      decodeEntities(match[2] ?? match[3] ?? match[4]),
    );
  }
  return result;
}

function visibleText(html) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]*>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

function applyResponseCookies(response, jar) {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!value || /(?:^|;)\s*max-age=0(?:;|$)/iu.test(cookie)) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

async function probe(pathname, { jar = new Map(), headers, ...options } = {}) {
  const requestHeaders = new Headers(headers);
  if (jar.size) {
    requestHeaders.set(
      "cookie",
      [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }
  const response = await fetch(new URL(pathname, origin), {
    ...options,
    headers: requestHeaders,
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  applyResponseCookies(response, jar);
  return response;
}

function actionFormData(form) {
  const data = new FormData();
  for (const match of form.matchAll(/<input\b[^>]*>/giu)) {
    const input = attributes(match[0]);
    if (
      input.get("type") === "hidden" &&
      input.get("name")?.startsWith("$ACTION_")
    ) {
      data.append(input.get("name"), input.get("value") ?? "");
    }
  }
  assert.ok(
    [...data.keys()].some((key) => /^\$ACTION_(?:REF|ID)_/u.test(key)),
    "The test must submit Next.js's real Server Action metadata",
  );
  return data;
}

async function submit(badgeNumber, password) {
  const jar = new Map();
  const page = await probe("/login", { jar });
  assert.equal(page.status, 200, "The login page must be reachable");
  assert.equal(
    page.headers.get("x-sentriq-test-fixture"),
    "supabase",
    "Do not submit this test's fake credentials to a server without the fixture",
  );
  const html = await page.text();
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/giu)];
  const form = forms.find((match) => /name="badgeNumber"/u.test(match[0]));
  assert.ok(form, "The login page must contain the badge/password form");

  const data = actionFormData(form[0]);
  data.set("badgeNumber", badgeNumber);
  data.set("password", password);

  const response = await probe("/login", {
    method: "POST",
    body: data,
    headers: { origin: origin.origin, accept: "text/html" },
    jar,
  });
  const responseHtml = await response.text();
  assert.ok(
    !password || !responseHtml.includes(password),
    "The submitted password must never be echoed in the returned HTML",
  );
  return { response, jar, html: responseHtml, text: visibleText(responseHtml) };
}

async function expectPageRedirect(response, destination, label) {
  const html = await response.text();
  let location = response.headers.get("location");
  if (response.status === 200) {
    // Cache Components can flush the shell before an async server guard resolves.
    // Next.js then encodes redirect() as its documented refresh meta element.
    const refresh = [...html.matchAll(/<meta\b[^>]*>/giu)]
      .map((match) => attributes(match[0]))
      .find(
        (candidate) =>
          candidate.get("id") === "__next-page-redirect" &&
          candidate.get("http-equiv")?.toLowerCase() === "refresh",
      );
    assert.ok(
      refresh,
      `${label}: a streamed response must contain Next's redirect marker`,
    );
    location = refresh
      .get("content")
      ?.match(/^\s*\d+(?:\.\d+)?\s*;\s*url=(.+)$/iu)?.[1];
  } else {
    assert.equal(response.status, 307, `${label}: server redirect status`);
  }
  assert.ok(location, `${label}: server redirect destination`);
  assert.equal(
    new URL(location, origin).href,
    new URL(destination, origin).href,
    `${label}: fixed server-side role destination`,
  );
  assert.doesNotMatch(
    visibleText(html),
    /Fixture\s+User/u,
    `${label}: the rejected page must not render profile content`,
  );
  return response.status;
}

async function signOutFromPage(pathname, html, jar) {
  const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/giu)].find(
    (match) => /se déconnecter/iu.test(visibleText(match[0])),
  );
  assert.ok(
    form,
    "The protected page must expose its real sign-out action form",
  );
  assert.match(visibleText(form[0]), /sign out/iu, "English sign-out action");
  const response = await probe(pathname, {
    method: "POST",
    body: actionFormData(form[0]),
    headers: { origin: origin.origin, accept: "text/html" },
    jar,
  });
  assert.equal(
    response.status,
    303,
    "Sign-out must redirect from the Server Action",
  );
  assert.equal(
    new URL(response.headers.get("location"), origin).pathname,
    "/login",
    "Sign-out returns to the login page",
  );
  expectNoSession(jar, "Sign-out");
  const denied = await probe(pathname, { jar });
  assert.equal(
    denied.status,
    307,
    "A signed-out browser cannot reopen a protected page",
  );
  assert.equal(
    new URL(denied.headers.get("location"), origin).pathname,
    "/login",
    "The proxy rejects the signed-out session",
  );
  console.log(
    `Sign-out from ${pathname}: 303 → /login, cookies cleared, subsequent GET denied`,
  );
}

async function setFixtureProfile(state, role) {
  const response = await probe("/__sentriq_fixture__/profile", {
    method: "POST",
    headers: {
      origin: origin.origin,
      "content-type": "application/json",
      "x-sentriq-test-fixture": "supabase",
    },
    body: JSON.stringify({ badge: "000001", state, ...(role ? { role } : {}) }),
  });
  assert.equal(
    response.headers.get("x-sentriq-test-fixture"),
    "supabase",
    "Profile changes must be handled by the in-memory fixture preloader",
  );
  assert.equal(response.status, 204, "Fixture profile state updated in memory");
}

async function verifyExistingSessionGuards() {
  for (const state of ["inactive", "missing", "error", "unknown"]) {
    const { response, jar } = await submit("000001", "fixture-password");
    assert.equal(
      response.status,
      303,
      "The session starts with an approved profile",
    );
    const page = await probe("/agent", { jar });
    assert.equal(
      page.status,
      200,
      "The active fixture agent can open its page",
    );
    const pageHtml = await page.text();
    await setFixtureProfile(state);
    try {
      for (const pathname of ["/", "/agent", "/dispatch", "/admin"]) {
        const denied = await probe(pathname, { jar });
        await expectPageRedirect(
          denied,
          "/login",
          `Existing session with ${state} profile requesting ${pathname}`,
        );
      }
      console.log(
        `Existing session with ${state} profile: root and all role pages denied`,
      );
    } finally {
      await setFixtureProfile("active");
    }
    await signOutFromPage("/agent", pageHtml, jar);
  }

  const { response, jar } = await submit("000001", "fixture-password");
  assert.equal(response.status, 303, "Role-change probe starts as an agent");
  const page = await probe("/agent", { jar });
  assert.equal(page.status, 200, "Agent page before the role change");
  const pageHtml = await page.text();
  await setFixtureProfile("active", "supervisor");
  try {
    await expectPageRedirect(
      await probe("/agent", { jar }),
      "/dispatch",
      "The current database role replaces the original login role",
    );
    await expectPageRedirect(
      await probe("/", { jar }),
      "/dispatch",
      "Root reads the updated profile role",
    );
    const updatedPage = await probe("/dispatch", { jar });
    assert.equal(
      updatedPage.status,
      200,
      "The updated supervisor role can open dispatch",
    );
    const updatedText = visibleText(await updatedPage.text());
    assert.match(
      updatedText,
      /superviseur/iu,
      "The page shows the updated French role",
    );
    assert.match(
      updatedText,
      /supervisor/iu,
      "The page shows the updated English role",
    );
    console.log(
      "Existing session role change: old role page denied, root redirects, new role page allowed",
    );
  } finally {
    await setFixtureProfile("active");
  }
  await signOutFromPage("/agent", pageHtml, jar);
}

function alertText(html) {
  const alert = html.match(/<div\b[^>]*role="alert"[^>]*>([\s\S]*?)<\/div>/iu);
  assert.ok(alert, "An authentication error must expose an accessible alert");
  return visibleText(alert[1]);
}

function expectInvalidField(html, name, french, english) {
  const input = [...html.matchAll(/<input\b[^>]*>/giu)]
    .map((match) => attributes(match[0]))
    .find((candidate) => candidate.get("name") === name);
  assert.ok(input, `${name}: field must remain present after validation`);
  assert.equal(input.get("aria-invalid"), "true", `${name}: invalid state`);
  assert.ok(
    input.get("aria-describedby")?.split(/\s+/u).includes(`${name}-error`),
    `${name}: associate the field with its validation message`,
  );
  const message = html.match(
    new RegExp(`<p\\b[^>]*id="${name}-error"[^>]*>([\\s\\S]*?)<\\/p>`, "iu"),
  );
  assert.ok(message, `${name}: field error must be rendered`);
  const text = visibleText(message[1]);
  assert.match(text, french, `${name}: French validation message`);
  assert.match(text, english, `${name}: English validation message`);
}

function expectNoSession(jar, label) {
  assert.ok(
    ![...jar.keys()].some((name) => /^sb-.+-auth-token(?:\.\d+)?$/u.test(name)),
    `${label}: no Supabase auth cookie may remain`,
  );
}

function expectMessage(result, french, english, label) {
  assert.equal(
    result.response.status,
    200,
    `${label}: the form must display an error`,
  );
  assert.equal(
    result.response.headers.get("location"),
    null,
    `${label}: no redirect`,
  );
  assert.match(result.text, french, `${label}: French message`);
  assert.match(result.text, english, `${label}: English message`);
  expectNoSession(result.jar, label);
  console.log(`${label}: 200, bilingual error, no session`);
}

try {
  for (const pathname of ["/", "/agent", "/dispatch", "/admin"]) {
    const denied = await probe(pathname);
    assert.equal(denied.status, 307, `${pathname}: no session must be denied`);
    assert.equal(
      new URL(denied.headers.get("location"), origin).pathname,
      "/login",
      `${pathname}: unauthenticated destination`,
    );
  }
  console.log("Unauthenticated root and all role pages: 307 → /login");

  const login = await probe("/login");
  assert.equal(login.status, 200, "Login page must render");
  assert.equal(
    login.headers.get("x-sentriq-test-fixture"),
    "supabase",
    "Start this server with the Supabase fixture preloader before running the HTTP check",
  );
  const html = await login.text();
  const text = visibleText(html);
  assert.match(text, /matricule/iu, "French badge label");
  assert.match(text, /badge number/iu, "English badge label");
  assert.match(text, /mot de passe/iu, "French password label");
  assert.match(text, /password/iu, "English password label");
  assert.match(html, /autocomplete="username"/iu, "Badge autocomplete");
  const badgeInput = [...html.matchAll(/<input\b[^>]*>/giu)]
    .map((match) => attributes(match[0]))
    .find((input) => input.get("name") === "badgeNumber");
  assert.ok(badgeInput, "The badge field must be present");
  assert.equal(
    badgeInput.get("type"),
    "text",
    "Badge numbers preserve leading zeros as text",
  );
  assert.equal(
    badgeInput.get("inputmode"),
    "numeric",
    "Use the numeric mobile keyboard",
  );
  assert.equal(
    badgeInput.get("pattern"),
    "[0-9]+",
    "The badge field accepts ASCII digits only",
  );
  assert.ok(
    badgeInput
      .get("aria-describedby")
      ?.split(/\s+/u)
      .includes("badgeNumber-hint"),
    "The badge field is associated with its numeric-format hint",
  );
  assert.match(
    html,
    /autocomplete="current-password"/iu,
    "Password autocomplete",
  );
  console.log("Login page: 200, bilingual labels and password autocomplete");

  const empty = await submit("", "");
  expectMessage(empty, /matricule/iu, /badge number/iu, "Empty fields");
  expectInvalidField(
    empty.html,
    "badgeNumber",
    /saisissez votre matricule/iu,
    /enter your badge number/iu,
  );
  expectInvalidField(
    empty.html,
    "password",
    /saisissez votre mot de passe/iu,
    /enter your password/iu,
  );

  const blankBadge = await submit(" \t ", "fixture-password");
  expectMessage(blankBadge, /matricule/iu, /badge number/iu, "Blank badge");
  expectInvalidField(
    blankBadge.html,
    "badgeNumber",
    /saisissez votre matricule/iu,
    /enter your badge number/iu,
  );

  for (const [label, badge] of [
    ["letters", "AGENT"],
    ["mixed letters and digits", "12A3"],
    ["positive sign", "+1"],
    ["negative sign", "-1"],
    ["decimal dot", "1.5"],
    ["decimal comma", "1,5"],
    ["scientific notation", "1e3"],
    ["uppercase scientific notation", "1E3"],
    ["internal whitespace", "000 001"],
    ["non-ASCII digits", "１２３"],
  ]) {
    const result = await submit(badge, "fixture-password");
    expectMessage(
      result,
      /matricule/iu,
      /badge number/iu,
      `Invalid badge: ${label}`,
    );
    expectInvalidField(
      result.html,
      "badgeNumber",
      /matricule/iu,
      /badge number/iu,
    );
  }

  const wrongBadge = await submit("999999", "fixture-password");
  const wrongPassword = await submit("000001", "incorrect-fixture-password");
  const invalidFr = /matricule ou mot de passe invalide/iu;
  const invalidEn = /invalid badge number or password/iu;
  expectMessage(wrongBadge, invalidFr, invalidEn, "Unknown badge");
  expectMessage(wrongPassword, invalidFr, invalidEn, "Wrong password");
  assert.equal(
    wrongBadge.text.match(invalidFr)?.[0].toLowerCase(),
    wrongPassword.text.match(invalidFr)?.[0].toLowerCase(),
    "Unknown badges and wrong passwords must expose the same French error",
  );
  assert.equal(
    wrongBadge.text.match(invalidEn)?.[0].toLowerCase(),
    wrongPassword.text.match(invalidEn)?.[0].toLowerCase(),
    "Unknown badges and wrong passwords must expose the same English error",
  );
  assert.equal(
    alertText(wrongBadge.html),
    alertText(wrongPassword.html),
    "The complete alert must not disclose whether the badge or password was wrong",
  );

  for (const [badge, label] of [
    ["000004", "Missing"],
    ["000005", "Inactive"],
  ]) {
    const result = await submit(badge, "fixture-password");
    expectMessage(
      result,
      /compte désactivé, contactez votre superviseur/iu,
      /account disabled\. contact your supervisor/iu,
      `${label} profile`,
    );
  }

  for (const [badge, destination, frenchRole, englishRole] of [
    ["  000001  ", "/agent", /agent/iu, /agent/iu],
    ["000002", "/dispatch", /superviseur/iu, /supervisor/iu],
    ["000003", "/admin", /administrateur/iu, /admin(?:istrator)?/iu],
  ]) {
    const { response, jar } = await submit(badge, "fixture-password");
    assert.equal(
      response.status,
      303,
      `${destination}: successful Server Action redirect`,
    );
    assert.equal(
      new URL(response.headers.get("location"), origin).pathname,
      destination,
      "The authenticated profile decides the destination",
    );
    assert.ok(
      [...jar.keys()].some((name) =>
        /^sb-.+-auth-token(?:\.\d+)?$/u.test(name),
      ),
      "Successful login must persist the fixture auth session",
    );
    const landing = await probe(destination, { jar });
    assert.equal(
      landing.status,
      200,
      "The signed-in user can render their role page",
    );
    assert.equal(
      landing.headers.get("location"),
      null,
      "The proxy accepts the verified fixture session",
    );
    const pageHtml = await landing.text();
    const pageText = visibleText(pageHtml);
    assert.match(
      pageText,
      /Fixture\s+User/u,
      "The page displays the authenticated profile name",
    );
    assert.match(pageText, frenchRole, "The role has a French label");
    assert.match(pageText, englishRole, "The role has an English label");
    assert.match(pageText, /se déconnecter/iu, "French sign-out button");
    assert.match(pageText, /sign out/iu, "English sign-out button");
    console.log(
      `Role redirect: 303 → ${destination}; own page: 200, name, role, bilingual sign-out`,
    );

    for (const otherPage of ["/agent", "/dispatch", "/admin"].filter(
      (candidate) => candidate !== destination,
    )) {
      const redirected = await probe(otherPage, { jar });
      const status = await expectPageRedirect(
        redirected,
        destination,
        `${destination} user requesting ${otherPage}`,
      );
      console.log(
        `Role boundary: GET ${otherPage}: ${status} → ${destination}`,
      );
    }
    const root = await probe("/", { jar });
    const rootStatus = await expectPageRedirect(
      root,
      destination,
      "Authenticated root",
    );
    console.log(`Authenticated root: ${rootStatus} → ${destination}`);
    await signOutFromPage(destination, pageHtml, jar);
  }

  for (const [badge, label] of [
    ["000006", "Profile query failure"],
    ["000007", "Unknown role"],
    ["000008", "Logout failure"],
  ]) {
    const result = await submit(badge, "fixture-password");
    expectMessage(
      result,
      /(?:indisponible|désactivé)/iu,
      /(?:unavailable|disabled)/iu,
      `${label} fails closed`,
    );
  }

  await verifyExistingSessionGuards();

  console.log(
    "Authentication and role-page HTTP checks passed; no hosted Auth accounts or database rows were changed.",
  );
} catch (error) {
  // Assertions use static descriptions so cookies and form values never appear.
  console.error(
    error instanceof Error ? error.message : "Login HTTP check failed",
  );
  process.exitCode = 1;
}
