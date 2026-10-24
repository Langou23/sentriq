import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentWorkspace } from "../server";
import type { AgentWorkspaceResponse } from "../index";
import {
  agentId,
  agentProfile,
  otherAgentId,
  queryClient,
  reply,
  serverNow,
  sessionRecord,
  siteId,
  siteRecord,
  type QueryReply,
} from "./query-client";

const dependencies = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireProfile: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: dependencies.createClient,
}));
vi.mock("@/modules/auth/server", () => ({
  requireProfile: dependencies.requireProfile,
}));

type WorkspacePlan = Partial<
  Record<
    "assignments" | "sites" | "open" | "closed" | "historicalSite",
    QueryReply
  >
>;

function workspaceClient(plan: WorkspacePlan = {}) {
  const transport = queryClient((query) => {
    if (query.table === "assignments")
      return plan.assignments ?? reply([{ site_id: siteId }]);
    if (query.table === "work_sessions") {
      return query.steps.some((step) => step.method === "not")
        ? (plan.closed ?? reply(null))
        : (plan.open ?? reply(null));
    }
    if (query.table === "sites") {
      return query.steps.some((step) => step.method === "in")
        ? (plan.sites ?? reply([siteRecord()]))
        : (plan.historicalSite ?? reply(siteRecord({ is_active: false })));
    }
    throw new Error(`Unexpected workspace query to ${query.table}`);
  });
  dependencies.createClient.mockResolvedValue(transport.client);
  return transport;
}

function assertUnavailable(response: AgentWorkspaceResponse): void {
  expect(response.profile).toEqual(agentProfile());
  expect(response.result.success).toBe(false);
  if (response.result.success)
    throw new Error("Expected an unavailable workspace.");
  expect(response.result.code).toBe("service_unavailable");
  expect(response.result.message.fr.trim()).not.toBe("");
  expect(response.result.message.en.trim()).not.toBe("");
  expect(response.result.message.fr).not.toBe(response.result.message.en);
  expect(response.result).not.toHaveProperty("data");
  expect(JSON.stringify(response)).not.toContain("PRIVATE_UPSTREAM");
}

beforeEach(() => {
  vi.resetAllMocks();
  dependencies.requireProfile.mockResolvedValue(agentProfile());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(serverNow));
});
afterEach(() => vi.useRealTimers());

describe("getAgentWorkspace", () => {
  it("propagates the active-agent auth guard redirect before reading data", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    dependencies.requireProfile.mockRejectedValue(redirect);
    await expect(getAgentWorkspace()).rejects.toBe(redirect);
    expect(dependencies.requireProfile).toHaveBeenCalledExactlyOnceWith(
      "agent",
    );
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it("distinguishes a successful empty workspace from a loading failure", async () => {
    const transport = workspaceClient({ assignments: reply([]) });
    expect(await getAgentWorkspace()).toEqual({
      profile: agentProfile(),
      result: {
        success: true,
        data: {
          sites: [],
          openSession: null,
          lastClosedSession: null,
          serverNow,
        },
      },
    });
    expect(transport.queries.some((query) => query.table === "sites")).toBe(
      false,
    );
  });

  it("deduplicates assignments and site rows while exposing only site summaries", async () => {
    const transport = workspaceClient({
      assignments: reply([{ site_id: siteId }, { site_id: siteId }]),
      sites: reply([siteRecord(), siteRecord()]),
    });
    const response = await getAgentWorkspace();
    expect(response.result).toEqual({
      success: true,
      data: {
        sites: [{ id: siteId, name: "Test site", address: null, radiusM: 150 }],
        openSession: null,
        lastClosedSession: null,
        serverNow,
      },
    });
    const assignments = transport.queries.find(
      (query) => query.table === "assignments",
    );
    expect(assignments?.steps).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["agent_id", agentId] },
        { method: "eq", args: ["is_active", true] },
      ]),
    );
    const sites = transport.queries.find((query) => query.table === "sites");
    expect(sites?.steps).toEqual(
      expect.arrayContaining([
        { method: "in", args: ["id", [siteId]] },
        { method: "eq", args: ["is_active", true] },
        { method: "order", args: ["name", { ascending: true }] },
      ]),
    );
  });

  it("selects the newest closed session by owner and preserves its perimeter warning", async () => {
    const transport = workspaceClient({
      closed: reply(
        sessionRecord({
          check_out_at: serverNow,
          check_out_distance_m: 200,
          check_out_within_radius: false,
        }),
      ),
    });
    const response = await getAgentWorkspace();
    expect(response.result).toMatchObject({
      success: true,
      data: {
        lastClosedSession: {
          checkOutAt: serverNow,
          checkOutDistanceM: 200,
          checkOutWithinRadius: false,
        },
      },
    });
    const closed = transport.queries.find((query) =>
      query.steps.some((step) => step.method === "not"),
    );
    expect(closed?.steps).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["agent_id", agentId] },
        { method: "not", args: ["check_out_at", "is", null] },
        { method: "order", args: ["check_out_at", { ascending: false }] },
        { method: "limit", args: [1] },
      ]),
    );
  });

  it("loads an open session's deactivated site without requiring a current assignment", async () => {
    const transport = workspaceClient({
      assignments: reply([]),
      open: reply(sessionRecord()),
      closed: reply(
        sessionRecord({
          id: "30000000-0000-4000-8000-000000000302",
          check_out_at: serverNow,
        }),
      ),
      historicalSite: reply(siteRecord({ is_active: false })),
    });
    const response = await getAgentWorkspace();
    expect(response.result).toMatchObject({
      success: true,
      data: {
        sites: [],
        openSession: { site: { id: siteId, name: "Test site" } },
        lastClosedSession: { site: { id: siteId } },
      },
    });
    const siteReads = transport.queries.filter(
      (query) => query.table === "sites",
    );
    expect(siteReads).toHaveLength(1);
    expect(siteReads[0].steps).toContainEqual({
      method: "eq",
      args: ["id", siteId],
    });
    expect(siteReads[0].steps).not.toContainEqual({
      method: "eq",
      args: ["is_active", true],
    });
  });

  it("allows an unreadable historical site summary on a closed session", async () => {
    workspaceClient({
      assignments: reply([]),
      closed: reply(sessionRecord({ check_out_at: serverNow })),
      historicalSite: reply(null),
    });
    const response = await getAgentWorkspace();
    expect(response.result).toMatchObject({
      success: true,
      data: { lastClosedSession: { site: null } },
    });
  });

  it("does not expose an open session whose site cannot be loaded", async () => {
    workspaceClient({
      assignments: reply([]),
      open: reply(sessionRecord()),
      historicalSite: reply(null),
    });
    assertUnavailable(await getAgentWorkspace());
  });

  it.each(["assignments", "sites", "open", "closed"] as const)(
    "sanitizes a %s query error instead of returning an empty workspace",
    async (stage) => {
      workspaceClient({
        [stage]: reply(null, { message: "PRIVATE_UPSTREAM database detail" }),
      });
      assertUnavailable(await getAgentWorkspace());
    },
  );

  it("sanitizes a failure to read a session's historical site", async () => {
    workspaceClient({
      assignments: reply([]),
      open: reply(sessionRecord()),
      historicalSite: reply(null, { message: "PRIVATE_UPSTREAM site detail" }),
    });
    assertUnavailable(await getAgentWorkspace());
  });

  it("sanitizes client configuration failures", async () => {
    dependencies.createClient.mockRejectedValue(
      new Error("PRIVATE_UPSTREAM config"),
    );
    assertUnavailable(await getAgentWorkspace());
  });

  it.each([
    {
      label: "an invalid assignment",
      plan: { assignments: reply([{ site_id: "not-a-uuid" }]) },
    },
    {
      label: "an inactive assigned site",
      plan: { sites: reply([siteRecord({ is_active: false })]) },
    },
    {
      label: "another agent's session",
      plan: { open: reply(sessionRecord({ agent_id: otherAgentId })) },
    },
    {
      label: "a closed session returned as open",
      plan: { open: reply(sessionRecord({ check_out_at: serverNow })) },
    },
    {
      label: "an open session returned as closed",
      plan: { closed: reply(sessionRecord()) },
    },
  ])(
    "rejects $label before building the public workspace",
    async ({ plan }) => {
      workspaceClient(plan);
      assertUnavailable(await getAgentWorkspace());
    },
  );

  it("never shares identity or site snapshots across requests", async () => {
    const first = workspaceClient();
    const second = workspaceClient({
      sites: reply([siteRecord({ name: "Fresh site" })]),
    });
    dependencies.requireProfile
      .mockResolvedValueOnce(agentProfile())
      .mockResolvedValueOnce(
        agentProfile({ id: otherAgentId, badgeNumber: "000002" }),
      );
    dependencies.createClient
      .mockReset()
      .mockResolvedValueOnce(first.client)
      .mockResolvedValueOnce(second.client);
    const firstResponse = await getAgentWorkspace();
    const secondResponse = await getAgentWorkspace();
    expect(firstResponse.profile.id).toBe(agentId);
    expect(secondResponse.profile.id).toBe(otherAgentId);
    expect(firstResponse.result).toMatchObject({
      success: true,
      data: { sites: [{ name: "Test site" }] },
    });
    expect(secondResponse.result).toMatchObject({
      success: true,
      data: { sites: [{ name: "Fresh site" }] },
    });
    expect(dependencies.requireProfile).toHaveBeenCalledTimes(2);
    expect(dependencies.createClient).toHaveBeenCalledTimes(2);
    for (const query of second.queries.filter(
      (query) => query.table !== "sites",
    )) {
      expect(query.steps).toContainEqual({
        method: "eq",
        args: ["agent_id", otherAgentId],
      });
    }
  });
});
