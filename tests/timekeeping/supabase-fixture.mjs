import "../auth/supabase-fixture.mjs";
import { randomUUID } from "node:crypto";
import { Server } from "node:http";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

// This preloader is test infrastructure only. It never enables a route, mock,
// privileged credential, GPS override, or alternate data path in application code.
const authFetch = globalThis.fetch;
const authEmit = Server.prototype.emit;
const controlPath = "/__sentriq_fixture__/timekeeping";
const tables = new Set(["sites", "assignments", "work_sessions"]);
const scenarios = new Set(["none", "one", "two", "load_error"]);
const geoModes = new Set([
  "inside",
  "outside",
  "denied",
  "unavailable",
  "timeout",
  "unsupported",
]);
const siteTemplates = [
  {
    id: randomUUID(),
    name: "Demo site A",
    address: "100 Demo Street, Montréal, QC",
    latitude: 45.52,
    longitude: -73.58,
    radius_m: 150,
    is_active: true,
  },
  {
    id: randomUUID(),
    name: "Demo site B",
    address: "200 Demo Street, Montréal, QC",
    latitude: 45.54,
    longitude: -73.62,
    radius_m: 150,
    is_active: true,
  },
];

let scenario = "two";
let geoMode = "inside";
let geoSite = 0;
let geoDelayMs = 300;
let seedOpen = false;
let race = null;
let siteRows = structuredClone(siteTemplates);
const identities = new Map();
const provisioned = new Set();
const assignmentRows = [];
const sessionRows = [];
let calls = newCalls();
let geoRequests = [];

function newCalls() {
  return {
    requests: {},
    inserts: 0,
    closes: 0,
    concurrentInserts: 0,
    concurrentCloses: 0,
  };
}

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Retry-After": "0" },
  });
}

function failure(code, message, status = 403) {
  return json({ code, message, details: null, hint: null }, status);
}

function openSession(agentId) {
  return sessionRows.find(
    (row) => row.agent_id === agentId && row.check_out_at === null,
  );
}

function makeSession(agentId, siteId, input = {}) {
  const now = new Date().toISOString();
  const site = siteRows.find((row) => row.id === siteId) ?? siteTemplates[0];
  return {
    id: randomUUID(),
    agent_id: agentId,
    site_id: siteId,
    check_in_at: now,
    check_in_lat: input.check_in_lat ?? site.latitude,
    check_in_lng: input.check_in_lng ?? site.longitude,
    check_in_distance_m: input.check_in_distance_m ?? 0,
    check_in_within_radius: input.check_in_within_radius ?? true,
    check_out_at: null,
    check_out_lat: null,
    check_out_lng: null,
    check_out_distance_m: null,
    check_out_within_radius: null,
    created_at: now,
    updated_at: now,
  };
}

function provision(identity) {
  if (
    provisioned.has(identity.id) ||
    identity.role !== "agent" ||
    !identity.isActive
  )
    return;
  provisioned.add(identity.id);
  const count = scenario === "none" ? 0 : scenario === "one" ? 1 : 2;
  for (const site of siteRows.slice(0, count)) {
    assignmentRows.push({
      id: randomUUID(),
      agent_id: identity.id,
      site_id: site.id,
      is_active: true,
    });
  }
  if (seedOpen && !openSession(identity.id)) {
    sessionRows.push(makeSession(identity.id, siteRows[0].id));
  }
}

function resetData() {
  siteRows = structuredClone(siteTemplates);
  assignmentRows.length = 0;
  sessionRows.length = 0;
  provisioned.clear();
  calls = newCalls();
  geoRequests = [];
  for (const identity of identities.values()) provision(identity);
}

async function verifiedIdentity(request, url) {
  const headers = new Headers(request.headers);
  headers.set("accept", "application/json");
  const userReply = await authFetch(`${url.origin}/auth/v1/user`, { headers });
  if (!userReply.ok) return null;
  const user = await userReply.json();
  if (typeof user.id !== "string") return null;
  const profileUrl = new URL("/rest/v1/profiles", url.origin);
  profileUrl.searchParams.set("id", `eq.${user.id}`);
  const profileReply = await authFetch(profileUrl, { headers });
  if (!profileReply.ok) return null;
  const [profile] = await profileReply.json();
  if (!profile || profile.id !== user.id) return null;
  const identity = {
    id: user.id,
    badge: profile.badge_number,
    role: profile.role,
    isActive: profile.is_active === true,
  };
  identities.set(identity.id, identity);
  provision(identity);
  return identity;
}

function readableRows(table, identity) {
  const manager =
    identity.isActive && ["supervisor", "admin"].includes(identity.role);
  const activeAgent = identity.isActive && identity.role === "agent";
  if (table === "sites") {
    const ownOpenSite = activeAgent ? openSession(identity.id)?.site_id : null;
    return siteRows.filter(
      (row) =>
        row.is_active ||
        (identity.isActive && identity.role === "admin") ||
        row.id === ownOpenSite,
    );
  }
  const rows = table === "assignments" ? assignmentRows : sessionRows;
  return rows.filter(
    (row) => manager || (activeAgent && row.agent_id === identity.id),
  );
}

class QueryError extends Error {}

function matches(value, filter) {
  if (filter.startsWith("not.")) return !matches(value, filter.slice(4));
  if (filter === "is.null") return value === null;
  if (filter.startsWith("eq.")) {
    const expected = filter.slice(3);
    if (typeof value === "boolean") return String(value) === expected;
    if (typeof value === "number") return value === Number(expected);
    return value === expected;
  }
  if (filter.startsWith("in.(") && filter.endsWith(")")) {
    return filter
      .slice(4, -1)
      .split(",")
      .map((item) => item.replace(/^"|"$/gu, ""))
      .includes(String(value));
  }
  throw new QueryError("The fixture does not support this query filter.");
}

function filteredRows(rows, url) {
  let selected = [...rows];
  for (const [column, filter] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(column)) continue;
    selected = selected.filter((row) => {
      if (!Object.hasOwn(row, column))
        throw new QueryError("Unknown fixture query column.");
      return matches(row[column], filter);
    });
  }
  const order = url.searchParams.get("order");
  if (order) {
    const fields = order.split(",").map((field) => field.split("."));
    selected.sort((left, right) => {
      for (const [column, direction] of fields) {
        const a = left[column];
        const b = right[column];
        const compared =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b));
        if (compared) return direction === "desc" ? -compared : compared;
      }
      return 0;
    });
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? selected.length);
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 0
  ) {
    throw new QueryError("Invalid fixture query limit.");
  }
  return selected.slice(offset, offset + limit);
}

function representation(rows, request, url, status = 200) {
  const select = url.searchParams.get("select");
  const projected =
    !select || select === "*"
      ? rows
      : rows.map((row) => {
          const result = {};
          for (const column of select.split(",")) {
            if (!Object.hasOwn(row, column))
              throw new QueryError("Unknown fixture select column.");
            result[column] = row[column];
          }
          return result;
        });
  if (
    request.headers.get("accept")?.includes("application/vnd.pgrst.object+json")
  ) {
    if (projected.length !== 1) {
      return json(
        {
          code: "PGRST116",
          details: `The result contains ${projected.length} rows`,
          message: "JSON object requested, multiple (or no) rows returned",
          hint: null,
        },
        406,
      );
    }
    return json(projected[0], status);
  }
  return json(projected, status);
}

function validCoordinates(latitude, longitude) {
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

async function insertWorkSession(request, url, identity) {
  const input = await request.json();
  const allowed = [
    "agent_id",
    "site_id",
    "check_in_lat",
    "check_in_lng",
    "check_in_distance_m",
    "check_in_within_radius",
  ];
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  ) {
    return failure("42501", "Fixture insert columns are not permitted.");
  }
  const site = siteRows.find((row) => row.id === input.site_id);
  const assigned = assignmentRows.some(
    (row) =>
      row.agent_id === identity.id &&
      row.site_id === input.site_id &&
      row.is_active,
  );
  if (
    !identity.isActive ||
    identity.role !== "agent" ||
    input.agent_id !== identity.id ||
    !site?.is_active ||
    !assigned
  ) {
    return failure("42501", "Fixture row-level security denied the insert.");
  }
  if (
    !validCoordinates(input.check_in_lat, input.check_in_lng) ||
    !Number.isInteger(input.check_in_distance_m) ||
    input.check_in_distance_m < 0 ||
    typeof input.check_in_within_radius !== "boolean"
  ) {
    return failure("23514", "Fixture check-in constraint failed.", 400);
  }
  if (race === "insert" && !openSession(identity.id)) {
    race = null;
    sessionRows.push(makeSession(identity.id, site.id));
    calls.concurrentInserts += 1;
  }
  if (openSession(identity.id)) {
    return failure(
      "23505",
      "Fixture one-open-session unique constraint failed.",
      409,
    );
  }
  const row = makeSession(identity.id, site.id, input);
  sessionRows.push(row);
  calls.inserts += 1;
  return representation([row], request, url, 201);
}

async function closeWorkSession(request, url, identity) {
  const input = await request.json();
  const allowed = [
    "check_out_at",
    "check_out_lat",
    "check_out_lng",
    "check_out_distance_m",
    "check_out_within_radius",
  ];
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  ) {
    return failure(
      "42501",
      "Fixture check-in and identity values are immutable.",
    );
  }
  if (!identity.isActive || identity.role !== "agent") {
    return failure("42501", "Fixture row-level security denied the update.");
  }
  let rows = filteredRows(
    sessionRows.filter(
      (row) => row.agent_id === identity.id && row.check_out_at === null,
    ),
    url,
  );
  if (race === "close" && rows[0]) {
    race = null;
    Object.assign(rows[0], {
      check_out_at: new Date().toISOString(),
      check_out_lat: siteTemplates[0].latitude,
      check_out_lng: siteTemplates[0].longitude,
      check_out_distance_m: 0,
      check_out_within_radius: true,
      updated_at: new Date().toISOString(),
    });
    calls.concurrentCloses += 1;
    rows = [];
  }
  if (
    rows.length &&
    (!validCoordinates(input.check_out_lat, input.check_out_lng) ||
      !Number.isFinite(Date.parse(input.check_out_at)) ||
      !Number.isInteger(input.check_out_distance_m) ||
      input.check_out_distance_m < 0 ||
      typeof input.check_out_within_radius !== "boolean" ||
      rows.some(
        (row) => Date.parse(input.check_out_at) < Date.parse(row.check_in_at),
      ))
  ) {
    return failure("23514", "Fixture check-out constraint failed.", 400);
  }
  for (const row of rows)
    Object.assign(row, input, { updated_at: new Date().toISOString() });
  calls.closes += rows.length;
  return representation(rows, request, url);
}

globalThis.fetch = async function timekeepingFetch(input, init) {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl);
  const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/u)?.[1];
  if (!url.hostname.endsWith(".supabase.co") || !tables.has(table)) {
    return authFetch(input, init);
  }
  const request = new Request(input, init);
  const key = `${request.method} ${table}`;
  calls.requests[key] = (calls.requests[key] ?? 0) + 1;
  const identity = await verifiedIdentity(request, url);
  if (!identity)
    return failure("42501", "Fixture authentication is required.", 401);
  try {
    if (request.method === "GET") {
      if (scenario === "load_error")
        return failure("XX000", "Fixture workspace query is unavailable.", 500);
      return representation(
        filteredRows(readableRows(table, identity), url),
        request,
        url,
      );
    }
    if (table === "work_sessions" && request.method === "POST") {
      return await insertWorkSession(request, url, identity);
    }
    if (table === "work_sessions" && request.method === "PATCH") {
      return await closeWorkSession(request, url, identity);
    }
    return failure("42501", "The fixture does not permit this table mutation.");
  } catch (error) {
    if (error instanceof QueryError)
      return failure("PGRST100", error.message, 400);
    return failure("XX000", "The fixture rejected a malformed request.", 400);
  }
};

function geoState() {
  const site = siteTemplates[geoSite];
  return {
    mode: geoMode,
    site: geoSite,
    latitude: geoMode === "outside" ? 45.6 : site.latitude,
    longitude: geoMode === "outside" ? -73.7 : site.longitude,
    delayMs: geoDelayMs,
    requests: structuredClone(geoRequests),
  };
}

function snapshot() {
  return structuredClone({
    fixture: "sentriq-timekeeping",
    scenario,
    sites: siteRows,
    assignments: assignmentRows,
    workSessions: sessionRows,
    identities: [...identities.values()],
    calls,
    geo: geoState(),
    pending: { seedOpen, race },
  });
}

function allowedControl(request) {
  if (
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      request.socket.remoteAddress,
    ) ||
    request.headers["x-sentriq-test-fixture"] !== "supabase"
  )
    return false;
  const expected = `http://${request.headers.host}`;
  if (request.headers.origin) return request.headers.origin === expected;
  // Browsers do not add Origin to a same-origin GET. Require the browser's
  // same-origin fetch metadata and matching Referer instead; CLI calls use Origin.
  try {
    return (
      request.method === "GET" &&
      request.headers["sec-fetch-site"] === "same-origin" &&
      new URL(request.headers.referer).origin === expected
    );
  } catch {
    return false;
  }
}

function respond(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}

function applyControl(input) {
  const allowed = [
    "scenario",
    "geoMode",
    "geoSite",
    "geoDelayMs",
    "seedOpen",
    "race",
    "deactivate",
    "siteId",
    "reset",
  ];
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    (input.scenario !== undefined && !scenarios.has(input.scenario)) ||
    (input.geoMode !== undefined && !geoModes.has(input.geoMode)) ||
    (input.geoSite !== undefined && ![0, 1].includes(input.geoSite)) ||
    (input.geoDelayMs !== undefined &&
      (!Number.isInteger(input.geoDelayMs) ||
        input.geoDelayMs < 0 ||
        input.geoDelayMs > 5000)) ||
    (input.seedOpen !== undefined && typeof input.seedOpen !== "boolean") ||
    (input.reset !== undefined && typeof input.reset !== "boolean") ||
    (input.race !== undefined &&
      input.race !== null &&
      !["insert", "close"].includes(input.race)) ||
    (input.deactivate !== undefined &&
      !["site", "assignment", "both"].includes(input.deactivate)) ||
    (input.siteId !== undefined &&
      !siteTemplates.some((site) => site.id === input.siteId))
  ) {
    throw new Error("Invalid fixture control payload.");
  }
  if (input.reset) {
    scenario = "two";
    geoMode = "inside";
    geoSite = 0;
    geoDelayMs = 300;
    seedOpen = false;
    race = null;
  }
  if (input.scenario !== undefined) scenario = input.scenario;
  if (input.geoMode !== undefined) geoMode = input.geoMode;
  if (input.geoSite !== undefined) geoSite = input.geoSite;
  if (input.geoDelayMs !== undefined) geoDelayMs = input.geoDelayMs;
  if (input.seedOpen !== undefined) seedOpen = input.seedOpen;
  if (input.race !== undefined) race = input.race;
  if (input.reset || input.scenario !== undefined) resetData();
  if (input.seedOpen) {
    for (const identity of identities.values()) {
      if (
        identity.role === "agent" &&
        identity.isActive &&
        !openSession(identity.id)
      ) {
        sessionRows.push(makeSession(identity.id, siteRows[0].id));
      }
    }
  }
  if (input.deactivate) {
    const siteId =
      input.siteId ??
      sessionRows.find((row) => row.check_out_at === null)?.site_id ??
      siteRows[0].id;
    if (["site", "both"].includes(input.deactivate))
      siteRows.find((row) => row.id === siteId).is_active = false;
    if (["assignment", "both"].includes(input.deactivate)) {
      for (const row of assignmentRows)
        if (row.site_id === siteId) row.is_active = false;
    }
  }
}

function handleControl(request, response) {
  if (!allowedControl(request))
    return respond(response, 403, { error: "Fixture control denied." });
  if (request.method === "GET") {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.searchParams.get("geoRequest") === "1") {
      geoRequests.push({
        enableHighAccuracy:
          url.searchParams.get("enableHighAccuracy") === "true",
        timeout: Number(url.searchParams.get("timeout")),
        maximumAge: Number(url.searchParams.get("maximumAge")),
      });
    }
    return respond(response, 200, snapshot());
  }
  if (request.method !== "POST")
    return respond(response, 405, { error: "Fixture method denied." });
  let body = "";
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes <= 4096) body += chunk.toString("utf8");
  });
  request.on("end", () => {
    if (bytes > 4096)
      return respond(response, 413, { error: "Fixture payload too large." });
    try {
      applyControl(JSON.parse(body));
      return respond(response, 200, snapshot());
    } catch {
      return respond(response, 400, {
        error: "Invalid fixture control payload.",
      });
    }
  });
}

function installBrowserGeolocation(initialMode, endpoint) {
  function getCurrentPosition(success, error, options = {}) {
    const query = new URLSearchParams({
      geoRequest: "1",
      enableHighAccuracy: String(options.enableHighAccuracy),
      timeout: String(options.timeout),
      maximumAge: String(options.maximumAge),
    });
    fetch(`${endpoint}?${query}`, {
      headers: { "X-Sentriq-Test-Fixture": "supabase" },
      cache: "no-store",
      credentials: "omit",
    })
      .then((response) => {
        if (!response.ok)
          throw new Error("Fixture location control unavailable");
        return response.json();
      })
      .then(({ geo }) => {
        setTimeout(() => {
          if (["inside", "outside"].includes(geo.mode)) {
            success({
              coords: {
                latitude: geo.latitude,
                longitude: geo.longitude,
                accuracy: 5,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            });
          } else if (typeof error === "function") {
            error({
              code: geo.mode === "denied" ? 1 : geo.mode === "timeout" ? 3 : 2,
              message: "Simulated fixture location error",
            });
          }
        }, geo.delayMs);
      })
      .catch(() => {
        if (typeof error === "function")
          error({ code: 2, message: "Fixture location control unavailable" });
      });
  }
  // None of these methods retains or delegates to the real browser GPS API.
  const mock = {
    getCurrentPosition,
    watchPosition(success, error, options) {
      getCurrentPosition(success, error, options);
      return 1;
    },
    clearWatch() {},
  };
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: initialMode === "unsupported" ? undefined : mock,
  });
  Object.defineProperty(window, "__sentriqTimekeepingFixture", { value: true });
  document.documentElement.setAttribute(
    "data-sentriq-geolocation-fixture",
    "installed",
  );
}

function injectFixtureHtml(request, response) {
  if (!request.headers.accept?.includes("text/html")) return;
  const original = {
    write: response.write,
    end: response.end,
    writeHead: response.writeHead,
    flushHeaders: response.flushHeaders,
  };
  const chunks = [];
  function capture(chunk, encoding) {
    if (chunk !== undefined && chunk !== null && typeof chunk !== "function") {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(
              chunk,
              typeof encoding === "string" ? encoding : undefined,
            ),
      );
    }
  }
  response.writeHead = function fixtureWriteHead(status, reason, headers) {
    response.statusCode = status;
    if (typeof reason === "string") response.statusMessage = reason;
    const values = typeof reason === "string" ? headers : reason;
    if (Array.isArray(values)) {
      for (let index = 0; index < values.length; index += 2)
        response.setHeader(values[index], values[index + 1]);
    } else if (values) {
      for (const [name, value] of Object.entries(values))
        response.setHeader(name, value);
    }
    return response;
  };
  response.flushHeaders = function fixtureFlushHeaders() {};
  response.write = function fixtureWrite(chunk, encoding, callback) {
    capture(chunk, encoding);
    const done = typeof encoding === "function" ? encoding : callback;
    if (done) queueMicrotask(done);
    return true;
  };
  response.end = function fixtureEnd(chunk, encoding, callback) {
    capture(chunk, encoding);
    const done =
      typeof chunk === "function"
        ? chunk
        : typeof encoding === "function"
          ? encoding
          : callback;
    let output = Buffer.concat(chunks);
    const contentType = String(response.getHeader("content-type") ?? "");
    if (contentType.includes("text/html") && output.length) {
      try {
        const contentEncoding = response.getHeader("content-encoding");
        if (contentEncoding === "gzip") output = gunzipSync(output);
        if (contentEncoding === "br") output = brotliDecompressSync(output);
        if (contentEncoding === "deflate") output = inflateSync(output);
        const script = `<script id="sentriq-timekeeping-fixture">(${installBrowserGeolocation.toString()})(${JSON.stringify(geoMode)},${JSON.stringify(controlPath)});</script>`;
        const html = output.toString("utf8");
        output = Buffer.from(
          /<head(?:\s[^>]*)?>/iu.test(html)
            ? html.replace(/<head(?:\s[^>]*)?>/iu, (head) => `${head}${script}`)
            : `${script}${html}`,
        );
        response.removeHeader("content-encoding");
        response.removeHeader("etag");
        response.setHeader("Cache-Control", "no-store");
      } catch {
        // Never expose a document that might fall back to the real GPS API.
        output = Buffer.from(
          "The local GPS fixture could not prepare this page.",
        );
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.removeHeader("content-encoding");
      }
    }
    response.removeHeader("content-length");
    Object.assign(response, original);
    return original.end.call(response, output, done);
  };
}

Server.prototype.emit = function timekeepingEmit(event, ...args) {
  if (event === "request") {
    const [request, response] = args;
    response.setHeader("X-Sentriq-Test-Fixture", "supabase");
    response.setHeader("X-Sentriq-Timekeeping-Fixture", "memory");
    if (request.url?.split("?")[0] === controlPath) {
      handleControl(request, response);
      return true;
    }
    injectFixtureHtml(request, response);
  }
  return authEmit.call(this, event, ...args);
};
