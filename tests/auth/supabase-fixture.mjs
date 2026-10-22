import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Server } from "node:http";

// Preload only into an isolated local Next.js test server. No application source
// depends on this fixture, and no Supabase request can escape to the real project.
const nativeFetch = globalThis.fetch;
const nativeEmit = Server.prototype.emit;

// The HTTP runner refuses to submit its fake credentials without this marker.
// This keeps an accidentally unpreloaded production server out of the test.
Server.prototype.emit = function fixtureEmit(event, ...args) {
  if (event === "request") {
    const [request, response] = args;
    response.setHeader("X-Sentriq-Test-Fixture", "supabase");
    if (request.url?.split("?")[0] === "/__sentriq_fixture__/profile") {
      handleProfileControl(request, response);
      return true;
    }
  }
  return nativeEmit.call(this, event, ...args);
};

const signingKey = randomBytes(32);
const sessions = new Map();
const fixturePassword = "fixture-password";
const profileOverrides = new Map();
const profiles = new Map(
  [
    ["000001", "agent", true],
    ["000002", "supervisor", true],
    ["000003", "admin", true],
    ["000004", "agent", true], // Missing profile.
    ["000005", "agent", false], // Inactive profile.
    ["000006", "agent", true], // Profile query failure.
    ["000007", "unknown", true], // Unsupported role.
    ["000008", "agent", false], // Auth revocation failure.
  ].map(([badge, role, isActive]) => [
    `${badge}@sentriq.local`,
    { id: randomUUID(), badge, role, is_active: isActive },
  ]),
);

function handleProfileControl(request, response) {
  const isLoopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    request.socket.remoteAddress,
  );
  if (
    !isLoopback ||
    request.method !== "POST" ||
    request.headers.origin !== `http://${request.headers.host}` ||
    request.headers["x-sentriq-test-fixture"] !== "supabase"
  ) {
    response.writeHead(403).end();
    return;
  }

  let body = "";
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes <= 1024) body += chunk.toString("utf8");
  });
  request.on("end", () => {
    if (bytes > 1024) {
      response.writeHead(413).end();
      return;
    }
    try {
      const { badge, state, role } = JSON.parse(body);
      if (
        typeof badge !== "string" ||
        !profiles.has(`${badge}@sentriq.local`) ||
        !["active", "inactive", "missing", "error", "unknown"].includes(
          state,
        ) ||
        (role !== undefined && !["agent", "supervisor", "admin"].includes(role))
      ) {
        response.writeHead(400).end();
        return;
      }
      if (state === "active" && role === undefined) {
        profileOverrides.delete(badge);
      } else {
        profileOverrides.set(badge, { state, role });
      }
      response.writeHead(204, { "Cache-Control": "no-store" }).end();
    } catch {
      response.writeHead(400).end();
    }
  });
}

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function unauthorized() {
  return json(
    { code: "session_not_found", message: "Fixture session was not found" },
    401,
  );
}

function sessionFor(request) {
  const authorization = request.headers.get("authorization") ?? "";
  return sessions.get(authorization.replace(/^Bearer\s+/iu, ""));
}

function mintSession(profile, baseUrl) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const user = {
    id: profile.id,
    aud: "authenticated",
    role: "authenticated",
    email: `${profile.badge}@sentriq.local`,
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
  };
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: `${baseUrl}/auth/v1`,
      sub: profile.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      session_id: randomUUID(),
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", signingKey)
    .update(`${header}.${payload}`)
    .digest("base64url");
  const accessToken = `${header}.${payload}.${signature}`;
  const session = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: issuedAt + 3600,
    refresh_token: randomBytes(32).toString("base64url"),
    user,
  };
  sessions.set(accessToken, { profile, user });
  return session;
}

globalThis.fetch = async function fixtureFetch(input, init) {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl);
  if (!url.hostname.endsWith(".supabase.co")) {
    return nativeFetch(input, init);
  }

  const request = new Request(input, init);

  if (request.method === "GET" && url.pathname === "/auth/v1/settings") {
    return json({ external: {}, disable_signup: true });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/auth/v1/token" &&
    url.searchParams.get("grant_type") === "refresh_token"
  ) {
    // Sessions from a previous fixture process must expire without retry loops.
    return json(
      {
        code: "refresh_token_not_found",
        message: "Fixture refresh token was not found",
      },
      400,
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === "/auth/v1/token" &&
    url.searchParams.get("grant_type") === "password"
  ) {
    const credentials = await request.json();
    const profile = profiles.get(credentials.email);
    if (!profile || credentials.password !== fixturePassword) {
      return json(
        {
          code: "invalid_credentials",
          message: "Invalid login credentials",
        },
        400,
      );
    }
    return json(mintSession(profile, url.origin));
  }

  if (request.method === "GET" && url.pathname === "/auth/v1/user") {
    const session = sessionFor(request);
    return session ? json(session.user) : unauthorized();
  }

  if (request.method === "POST" && url.pathname === "/auth/v1/logout") {
    const session = sessionFor(request);
    if (!session) return unauthorized();
    if (session.profile.badge === "000008") {
      return json(
        { code: "unexpected_failure", message: "Fixture revocation outage" },
        500,
      );
    }
    const token = request.headers
      .get("authorization")
      .replace(/^Bearer\s+/iu, "");
    sessions.delete(token);
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && url.pathname === "/rest/v1/profiles") {
    const session = sessionFor(request);
    if (!session) return unauthorized();
    const profile = session.profile;
    const override = profileOverrides.get(profile.badge);
    if (url.searchParams.get("id") !== `eq.${profile.id}`) {
      return json(
        { message: "Fixture requires a filter for the signed-in user" },
        403,
      );
    }
    if (profile.badge === "000006" || override?.state === "error") {
      return json({ message: "Fixture profile service is unavailable" }, 500);
    }
    if (profile.badge === "000004" || override?.state === "missing") {
      return json([]);
    }
    return json([
      {
        id: profile.id,
        badge_number: profile.badge,
        first_name: "Fixture",
        last_name: "User",
        role:
          override?.state === "unknown"
            ? "unknown"
            : (override?.role ?? profile.role),
        is_active: override?.state === "inactive" ? false : profile.is_active,
      },
    ]);
  }

  // A missing fixture must fail closed rather than silently write to Supabase.
  throw new Error("The local Supabase fixture blocked an unexpected endpoint");
};
