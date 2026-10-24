import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkIn, checkOut } from "../actions";
import type { TimekeepingActionResult, TimekeepingErrorCode } from "../index";
import {
  agentId,
  agentProfile,
  otherAgentId,
  queryClient,
  reply,
  serverNow,
  sessionId,
  sessionRecord,
  siteId,
  siteRecord,
} from "./query-client";

const dependencies = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireProfile: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: dependencies.createClient,
}));
vi.mock("@/modules/auth/server", () => ({
  requireProfile: dependencies.requireProfile,
}));
vi.mock("next/cache", () => ({ revalidatePath: dependencies.revalidatePath }));

const position = { latitude: 0, longitude: 0 };

function assertFailure(
  result: TimekeepingActionResult,
  code: TimekeepingErrorCode,
): void {
  expect(result.success).toBe(false);
  if (result.success)
    throw new Error("Expected a rejected timekeeping action.");
  expect(result.code).toBe(code);
  expect(result.message.fr.trim()).not.toBe("");
  expect(result.message.en.trim()).not.toBe("");
  expect(result.message.fr).not.toBe(result.message.en);
  expect(Object.keys(result).sort()).toEqual(["code", "message", "success"]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_UPSTREAM");
  expect(dependencies.revalidatePath).not.toHaveBeenCalled();
}

function successfulCheckIn(row = sessionRecord()) {
  const transport = queryClient([
    reply(null),
    reply({ site_id: siteId }),
    reply(siteRecord()),
    reply(row),
  ]);
  dependencies.createClient.mockResolvedValue(transport.client);
  return transport;
}

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.requireProfile.mockResolvedValue(agentProfile());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(serverNow));
});
afterEach(() => vi.useRealTimers());

describe.each([
  { name: "checkIn", action: checkIn, identifier: { siteId } },
  { name: "checkOut", action: checkOut, identifier: { sessionId } },
])("$name authentication and input boundary", ({ action, identifier }) => {
  it("requires an active agent before handling even invalid input", async () => {
    assertFailure(await action(null), "invalid_input");
    expect(dependencies.requireProfile).toHaveBeenCalledExactlyOnceWith(
      "agent",
    );
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it("propagates authentication redirects without querying timekeeping data", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    dependencies.requireProfile.mockRejectedValue(redirect);
    await expect(action({ ...identifier, ...position })).rejects.toBe(redirect);
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(dependencies.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { label: "agent identity", extra: { agent_id: otherAgentId } },
    { label: "client timestamp", extra: { check_in_at: serverNow } },
    { label: "site radius", extra: { radiusM: 1_000_000 } },
    { label: "client distance", extra: { distanceM: 0 } },
    { label: "client perimeter flag", extra: { withinRadius: true } },
  ])("refuses an untrusted $label", async ({ extra }) => {
    assertFailure(
      await action({ ...identifier, ...position, ...extra }),
      "invalid_input",
    );
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it.each([
    { latitude: Number.NaN, longitude: 0 },
    { latitude: 91, longitude: 0 },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY },
    { latitude: "0", longitude: "0" },
  ])(
    "refuses invalid coordinates %j without creating a client",
    async (coordinates) => {
      assertFailure(
        await action({ ...identifier, ...coordinates }),
        "invalid_input",
      );
      expect(dependencies.createClient).not.toHaveBeenCalled();
    },
  );
});

describe("checkIn", () => {
  it.each([
    { longitude: 0, distanceM: 0, withinRadius: true },
    { longitude: 0.01, distanceM: 1112, withinRadius: false },
  ])(
    "computes and records the server perimeter result for longitude $longitude",
    async ({ longitude, distanceM, withinRadius }) => {
      const transport = successfulCheckIn(
        sessionRecord({
          check_in_distance_m: distanceM,
          check_in_within_radius: withinRadius,
        }),
      );
      const result = await checkIn({ siteId, latitude: 0, longitude });
      expect(result).toMatchObject({
        success: true,
        operation: "check_in",
        session: {
          id: sessionId,
          siteId,
          checkInAt: "2026-10-23T10:00:00.000Z",
          checkInDistanceM: distanceM,
          checkInWithinRadius: withinRadius,
        },
      });
      expect(transport.queries[3].payload).toEqual({
        agent_id: agentId,
        site_id: siteId,
        check_in_lat: 0,
        check_in_lng: longitude,
        check_in_distance_m: distanceM,
        check_in_within_radius: withinRadius,
      });
      expect(transport.queries[0].steps).toEqual(
        expect.arrayContaining([
          { method: "eq", args: ["agent_id", agentId] },
          { method: "is", args: ["check_out_at", null] },
        ]),
      );
      expect(transport.queries[1].steps).toEqual(
        expect.arrayContaining([
          { method: "eq", args: ["agent_id", agentId] },
          { method: "eq", args: ["site_id", siteId] },
          { method: "eq", args: ["is_active", true] },
        ]),
      );
      expect(transport.queries[2].steps).toContainEqual({
        method: "eq",
        args: ["is_active", true],
      });
      expect(dependencies.createClient).toHaveBeenCalledExactlyOnceWith({
        requireCookieWrites: true,
      });
      expect(dependencies.revalidatePath).toHaveBeenCalledExactlyOnceWith(
        "/agent",
      );
    },
  );

  it("returns already_open before reading assignments or writing another session", async () => {
    const transport = queryClient([reply(sessionRecord())]);
    dependencies.createClient.mockResolvedValue(transport.client);
    assertFailure(await checkIn({ siteId, ...position }), "already_open");
    expect(transport.queries).toHaveLength(1);
  });

  it.each([
    {
      label: "missing active assignment",
      responses: [reply(null), reply(null)],
    },
    {
      label: "missing active site",
      responses: [reply(null), reply({ site_id: siteId }), reply(null)],
    },
  ])("does not insert for $label", async ({ responses }) => {
    const transport = queryClient(responses);
    dependencies.createClient.mockResolvedValue(transport.client);
    assertFailure(await checkIn({ siteId, ...position }), "not_assigned");
    expect(
      transport.queries.every((query) => query.operation === "select"),
    ).toBe(true);
  });

  it("rejects a returned inactive site even if the transport ignored the active filter", async () => {
    const transport = queryClient([
      reply(null),
      reply({ site_id: siteId }),
      reply(siteRecord({ is_active: false })),
    ]);
    dependencies.createClient.mockResolvedValue(transport.client);
    assertFailure(
      await checkIn({ siteId, ...position }),
      "service_unavailable",
    );
    expect(
      transport.queries.every((query) => query.operation === "select"),
    ).toBe(true);
  });

  it("maps the database duplicate-open race to a safe business error", async () => {
    const transport = queryClient([
      reply(null),
      reply({ site_id: siteId }),
      reply(siteRecord()),
      reply(null, { code: "23505", message: "PRIVATE_UPSTREAM duplicate" }),
    ]);
    dependencies.createClient.mockResolvedValue(transport.client);
    assertFailure(await checkIn({ siteId, ...position }), "already_open");
    expect(transport.queries[3].operation).toBe("insert");
  });

  it.each([0, 1, 2, 3])(
    "sanitizes a database error at query stage %i",
    async (failedIndex) => {
      const responses = [
        reply(null),
        reply({ site_id: siteId }),
        reply(siteRecord()),
        reply(sessionRecord()),
      ];
      responses[failedIndex] = reply(null, {
        code: "57014",
        message: "PRIVATE_UPSTREAM diagnostic",
      });
      const transport = queryClient(responses);
      dependencies.createClient.mockResolvedValue(transport.client);
      assertFailure(
        await checkIn({ siteId, ...position }),
        "service_unavailable",
      );
      expect(transport.queries).toHaveLength(failedIndex + 1);
    },
  );

  it("sanitizes a session-cookie/client creation failure", async () => {
    dependencies.createClient.mockRejectedValue(
      new Error("PRIVATE_UPSTREAM cookies"),
    );
    assertFailure(
      await checkIn({ siteId, ...position }),
      "service_unavailable",
    );
  });

  it("rejects a session returned for another owner", async () => {
    successfulCheckIn(sessionRecord({ agent_id: otherAgentId }));
    assertFailure(
      await checkIn({ siteId, ...position }),
      "service_unavailable",
    );
  });

  it("rechecks identity and creates a fresh user client on each call", async () => {
    const first = successfulCheckIn();
    const second = queryClient([
      reply(null),
      reply({ site_id: siteId }),
      reply(siteRecord()),
      reply(sessionRecord({ agent_id: otherAgentId })),
    ]);
    dependencies.requireProfile
      .mockResolvedValueOnce(agentProfile())
      .mockResolvedValueOnce(
        agentProfile({ id: otherAgentId, badgeNumber: "000002" }),
      );
    dependencies.createClient
      .mockReset()
      .mockResolvedValueOnce(first.client)
      .mockResolvedValueOnce(second.client);
    expect((await checkIn({ siteId, ...position })).success).toBe(true);
    expect((await checkIn({ siteId, ...position })).success).toBe(true);
    expect(dependencies.requireProfile).toHaveBeenCalledTimes(2);
    expect(dependencies.createClient).toHaveBeenCalledTimes(2);
    expect(first.queries[3].payload?.agent_id).toBe(agentId);
    expect(second.queries[3].payload?.agent_id).toBe(otherAgentId);
  });
});

describe("checkOut", () => {
  it("uses the stored site after deactivation and writes only server checkout fields", async () => {
    const transport = queryClient([
      reply(sessionRecord()),
      reply(siteRecord({ is_active: false })),
      reply(
        sessionRecord({
          check_out_at: serverNow,
          check_out_distance_m: 1112,
          check_out_within_radius: false,
        }),
      ),
    ]);
    dependencies.createClient.mockResolvedValue(transport.client);
    const result = await checkOut({ sessionId, latitude: 0, longitude: 0.01 });
    expect(result).toMatchObject({
      success: true,
      operation: "check_out",
      session: {
        checkOutAt: serverNow,
        checkOutDistanceM: 1112,
        checkOutWithinRadius: false,
      },
    });
    expect(transport.queries.map((query) => query.table)).toEqual([
      "work_sessions",
      "sites",
      "work_sessions",
    ]);
    expect(transport.queries[1].steps).toContainEqual({
      method: "eq",
      args: ["id", siteId],
    });
    expect(transport.queries[1].steps).not.toContainEqual({
      method: "eq",
      args: ["is_active", true],
    });
    expect(transport.queries[2].payload).toEqual({
      check_out_at: serverNow,
      check_out_lat: 0,
      check_out_lng: 0.01,
      check_out_distance_m: 1112,
      check_out_within_radius: false,
    });
    expect(transport.queries[0].steps).toContainEqual({
      method: "eq",
      args: ["agent_id", agentId],
    });
    expect(transport.queries[2].steps).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["id", sessionId] },
        { method: "eq", args: ["agent_id", agentId] },
        { method: "is", args: ["check_out_at", null] },
      ]),
    );
    expect(dependencies.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/agent",
    );
  });

  it.each([
    {
      label: "missing own session",
      response: null,
      code: "no_open_session" as const,
    },
    {
      label: "already closed session",
      response: sessionRecord({ check_out_at: serverNow }),
      code: "session_closed" as const,
    },
  ])("does not write a $label", async ({ response, code }) => {
    const transport = queryClient([reply(response)]);
    dependencies.createClient.mockResolvedValue(transport.client);
    assertFailure(await checkOut({ sessionId, ...position }), code);
    expect(transport.queries).toHaveLength(1);
  });

  it("rejects another user's session even if a query returns it", async () => {
    const transport = queryClient([
      reply(sessionRecord({ agent_id: otherAgentId })),
    ]);
    dependencies.createClient.mockResolvedValue(transport.client);
    assertFailure(
      await checkOut({ sessionId, ...position }),
      "service_unavailable",
    );
    expect(transport.queries).toHaveLength(1);
  });

  it("fails safely when the stored site is unavailable", async () => {
    const transport = queryClient([reply(sessionRecord()), reply(null)]);
    dependencies.createClient.mockResolvedValue(transport.client);
    assertFailure(
      await checkOut({ sessionId, ...position }),
      "service_unavailable",
    );
    expect(
      transport.queries.every((query) => query.operation === "select"),
    ).toBe(true);
  });

  it("reports a concurrent zero-row checkout instead of claiming success", async () => {
    const transport = queryClient([
      reply(sessionRecord()),
      reply(siteRecord()),
      reply(null),
    ]);
    dependencies.createClient.mockResolvedValue(transport.client);
    assertFailure(await checkOut({ sessionId, ...position }), "session_closed");
    expect(transport.queries[2].operation).toBe("update");
  });

  it.each([0, 1, 2])(
    "sanitizes a checkout database failure at stage %i",
    async (failedIndex) => {
      const responses = [
        reply(sessionRecord()),
        reply(siteRecord()),
        reply(sessionRecord({ check_out_at: serverNow })),
      ];
      responses[failedIndex] = reply(null, {
        message: "PRIVATE_UPSTREAM checkout diagnostic",
      });
      dependencies.createClient.mockResolvedValue(
        queryClient(responses).client,
      );
      assertFailure(
        await checkOut({ sessionId, ...position }),
        "service_unavailable",
      );
    },
  );
});
