import type { AuthProfile } from "@/modules/auth";
import type { SessionRecord, SiteRecord } from "../repository";

export type QueryReply = { data: unknown; error: unknown };
export type QueryRecord = {
  table: string;
  operation: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  steps: { method: string; args: unknown[] }[];
};

interface QueryChain extends PromiseLike<QueryReply> {
  select(columns: string): QueryChain;
  eq(column: string, value: unknown): QueryChain;
  is(column: string, value: unknown): QueryChain;
  not(column: string, operator: string, value: unknown): QueryChain;
  in(column: string, values: unknown[]): QueryChain;
  order(column: string, options: unknown): QueryChain;
  limit(count: number): QueryChain;
  insert(payload: Record<string, unknown>): QueryChain;
  update(payload: Record<string, unknown>): QueryChain;
  maybeSingle(): Promise<QueryReply>;
  single(): Promise<QueryReply>;
}

export function reply(data: unknown, error: unknown = null): QueryReply {
  return { data, error };
}

// Only the request-bound Supabase query transport is replaced, not the repository.
export function queryClient(
  plan:
    QueryReply[] | ((query: QueryRecord) => QueryReply | Promise<QueryReply>),
) {
  const queries: QueryRecord[] = [];
  const queued = Array.isArray(plan) ? [...plan] : [];
  const resolve = (query: QueryRecord) => {
    if (typeof plan === "function") return plan(query);
    const response = queued.shift();
    if (!response)
      throw new Error(`Unexpected ${query.operation} on ${query.table}`);
    return response;
  };

  const client = {
    from(table: string): QueryChain {
      const query: QueryRecord = { table, operation: "select", steps: [] };
      queries.push(query);
      let response: Promise<QueryReply> | undefined;
      const finish = () => {
        response ??= Promise.resolve().then(() => resolve(query));
        return response;
      };
      const step = (method: string, args: unknown[]) => {
        query.steps.push({ method, args });
        return chain;
      };
      const chain: QueryChain = {
        select: (columns) => step("select", [columns]),
        eq: (column, value) => step("eq", [column, value]),
        is: (column, value) => step("is", [column, value]),
        not: (column, operator, value) =>
          step("not", [column, operator, value]),
        in: (column, values) => step("in", [column, values]),
        order: (column, options) => step("order", [column, options]),
        limit: (count) => step("limit", [count]),
        insert(payload) {
          query.operation = "insert";
          query.payload = payload;
          return step("insert", [payload]);
        },
        update(payload) {
          query.operation = "update";
          query.payload = payload;
          return step("update", [payload]);
        },
        maybeSingle() {
          step("maybeSingle", []);
          return finish();
        },
        single() {
          step("single", []);
          return finish();
        },
        then(onfulfilled, onrejected) {
          return finish().then(onfulfilled, onrejected);
        },
      };
      return chain;
    },
  };
  return { client, queries };
}

export const agentId = "30000000-0000-4000-8000-000000000001";
export const otherAgentId = "30000000-0000-4000-8000-000000000002";
export const siteId = "30000000-0000-4000-8000-000000000101";
export const sessionId = "30000000-0000-4000-8000-000000000301";
export const serverNow = "2026-10-23T12:00:00.000Z";

export function agentProfile(
  overrides: Partial<AuthProfile> = {},
): AuthProfile {
  return {
    id: agentId,
    badgeNumber: "000001",
    firstName: "Camille",
    lastName: "Tremblay",
    role: "agent",
    isActive: true,
    ...overrides,
  };
}

export function siteRecord(overrides: Partial<SiteRecord> = {}): SiteRecord {
  return {
    id: siteId,
    name: "Test site",
    address: null,
    latitude: 0,
    longitude: 0,
    radius_m: 150,
    is_active: true,
    ...overrides,
  };
}

export function sessionRecord(
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    id: sessionId,
    agent_id: agentId,
    site_id: siteId,
    check_in_at: "2026-10-23T10:00:00.000Z",
    check_in_distance_m: 0,
    check_in_within_radius: true,
    check_out_at: null,
    check_out_distance_m: null,
    check_out_within_radius: null,
    ...overrides,
  };
}
