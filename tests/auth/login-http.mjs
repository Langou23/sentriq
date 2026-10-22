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

  const data = new FormData();
  for (const match of form[0].matchAll(/<input\b[^>]*>/giu)) {
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
  assert.equal(
    input.get("aria-describedby"),
    `${name}-error`,
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

  const wrongBadge = await submit("DOES_NOT_EXIST", "fixture-password");
  const wrongPassword = await submit("AGENT", "incorrect-fixture-password");
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

  for (const badge of ["MISSING", "INACTIVE"]) {
    const result = await submit(badge, "fixture-password");
    expectMessage(
      result,
      /compte désactivé, contactez votre superviseur/iu,
      /account disabled\. contact your supervisor/iu,
      `${badge} profile`,
    );
  }

  for (const [badge, destination] of [
    ["  agent  ", "/agent"],
    ["SUPERVISOR", "/dispatch"],
    ["ADMIN", "/admin"],
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
      404,
      "Role pages intentionally arrive in the next step",
    );
    assert.equal(
      landing.headers.get("location"),
      null,
      "The proxy accepts the verified fixture session",
    );
    console.log(
      `Role redirect: 303 → ${destination}; authenticated GET: 404 (expected)`,
    );
  }

  for (const badge of ["PROFILE_ERROR", "UNKNOWN", "LOGOUT_ERROR"]) {
    const result = await submit(badge, "fixture-password");
    expectMessage(
      result,
      /(?:indisponible|désactivé)/iu,
      /(?:unavailable|disabled)/iu,
      `${badge} fails closed`,
    );
  }

  console.log(
    "Login HTTP checks passed; no hosted Auth accounts or database rows were changed.",
  );
} catch (error) {
  // Assertions use static descriptions so cookies and form values never appear.
  console.error(
    error instanceof Error ? error.message : "Login HTTP check failed",
  );
  process.exitCode = 1;
}
