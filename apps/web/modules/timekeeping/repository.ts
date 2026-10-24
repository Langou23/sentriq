import "server-only";

import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import type { Position, SiteSummary, WorkSession } from "./types";

type UserClient = Awaited<ReturnType<typeof createClient>>;

const siteColumns = "id,name,address,latitude,longitude,radius_m,is_active";
const sessionColumns =
  "id,agent_id,site_id,check_in_at,check_in_distance_m,check_in_within_radius,check_out_at,check_out_distance_m,check_out_within_radius";

const siteSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string().nullable(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  radius_m: z.number().int().positive(),
  is_active: z.boolean(),
});
const sessionSchema = z.object({
  id: z.uuid(),
  agent_id: z.uuid(),
  site_id: z.uuid(),
  check_in_at: z.iso.datetime({ offset: true }),
  check_in_distance_m: z.number().int().nonnegative().nullable(),
  check_in_within_radius: z.boolean().nullable(),
  check_out_at: z.iso.datetime({ offset: true }).nullable(),
  check_out_distance_m: z.number().int().nonnegative().nullable(),
  check_out_within_radius: z.boolean().nullable(),
});
const assignmentSchema = z.object({ site_id: z.uuid() });

export type SiteRecord = z.infer<typeof siteSchema>;
export type SessionRecord = z.infer<typeof sessionSchema>;

export class OpenSessionConflictError extends Error {
  constructor() {
    super("A work session is already open.");
  }
}

function ensureQuerySucceeded(error: unknown): void {
  if (error) throw new Error("Timekeeping data is unavailable.");
}

function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid timekeeping data.");
  return parsed.data;
}

function decodeOwnedSession(value: unknown, agentId: string): SessionRecord {
  const row = decode(sessionSchema, value);
  if (row.agent_id !== agentId)
    throw new Error("Invalid timekeeping session owner.");
  return row;
}

export function summarizeSite(site: SiteRecord): SiteSummary {
  return {
    id: site.id,
    name: site.name,
    address: site.address,
    radiusM: site.radius_m,
  };
}

export function summarizeSession(
  session: SessionRecord,
  site: SiteRecord | null,
): WorkSession {
  if (site && site.id !== session.site_id)
    throw new Error("Invalid timekeeping session site.");

  return {
    id: session.id,
    siteId: session.site_id,
    site: site ? summarizeSite(site) : null,
    checkInAt: session.check_in_at,
    checkInDistanceM: session.check_in_distance_m,
    checkInWithinRadius: session.check_in_within_radius,
    checkOutAt: session.check_out_at,
    checkOutDistanceM: session.check_out_distance_m,
    checkOutWithinRadius: session.check_out_within_radius,
  };
}

export async function readSite(
  client: UserClient,
  siteId: string,
  { activeOnly = false }: { activeOnly?: boolean } = {},
): Promise<SiteRecord | null> {
  let query = client.from("sites").select(siteColumns).eq("id", siteId);
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query.maybeSingle();
  ensureQuerySucceeded(error);
  if (data === null) return null;

  const site = decode(siteSchema, data);
  if (site.id !== siteId || (activeOnly && !site.is_active))
    throw new Error("Invalid timekeeping site.");
  return site;
}

export async function readAssignedSite(
  client: UserClient,
  agentId: string,
  siteId: string,
): Promise<SiteRecord | null> {
  const { data, error } = await client
    .from("assignments")
    .select("site_id")
    .eq("agent_id", agentId)
    .eq("site_id", siteId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  ensureQuerySucceeded(error);
  if (data === null) return null;
  if (decode(assignmentSchema, data).site_id !== siteId)
    throw new Error("Invalid timekeeping assignment.");
  return readSite(client, siteId, { activeOnly: true });
}

export async function readAssignedSites(
  client: UserClient,
  agentId: string,
): Promise<SiteRecord[]> {
  const { data: assignments, error: assignmentError } = await client
    .from("assignments")
    .select("site_id")
    .eq("agent_id", agentId)
    .eq("is_active", true);
  ensureQuerySucceeded(assignmentError);
  const siteIds = [
    ...new Set(
      decode(z.array(assignmentSchema), assignments).map((row) => row.site_id),
    ),
  ];
  if (siteIds.length === 0) return [];

  const { data, error } = await client
    .from("sites")
    .select(siteColumns)
    .in("id", siteIds)
    .eq("is_active", true)
    .order("name", { ascending: true });
  ensureQuerySucceeded(error);
  const sites = decode(z.array(siteSchema), data);
  if (sites.some((site) => !siteIds.includes(site.id) || !site.is_active))
    throw new Error("Invalid timekeeping assigned site.");
  return [...new Map(sites.map((site) => [site.id, site])).values()];
}

export async function readOpenSession(
  client: UserClient,
  agentId: string,
): Promise<SessionRecord | null> {
  const { data, error } = await client
    .from("work_sessions")
    .select(sessionColumns)
    .eq("agent_id", agentId)
    .is("check_out_at", null)
    .maybeSingle();
  ensureQuerySucceeded(error);
  if (data === null) return null;
  const session = decodeOwnedSession(data, agentId);
  if (session.check_out_at !== null)
    throw new Error("Invalid open timekeeping session.");
  return session;
}

export async function readLastClosedSession(
  client: UserClient,
  agentId: string,
): Promise<SessionRecord | null> {
  const { data, error } = await client
    .from("work_sessions")
    .select(sessionColumns)
    .eq("agent_id", agentId)
    .not("check_out_at", "is", null)
    .order("check_out_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  ensureQuerySucceeded(error);
  if (data === null) return null;
  const session = decodeOwnedSession(data, agentId);
  if (session.check_out_at === null)
    throw new Error("Invalid closed timekeeping session.");
  return session;
}

export async function readOwnedSession(
  client: UserClient,
  agentId: string,
  sessionId: string,
): Promise<SessionRecord | null> {
  const { data, error } = await client
    .from("work_sessions")
    .select(sessionColumns)
    .eq("id", sessionId)
    .eq("agent_id", agentId)
    .maybeSingle();
  ensureQuerySucceeded(error);
  if (data === null) return null;
  const session = decodeOwnedSession(data, agentId);
  if (session.id !== sessionId) throw new Error("Invalid timekeeping session.");
  return session;
}

export async function insertSession(
  client: UserClient,
  agentId: string,
  siteId: string,
  position: Position,
  perimeter: { distanceM: number; withinRadius: boolean },
): Promise<SessionRecord> {
  const { data, error } = await client
    .from("work_sessions")
    .insert({
      agent_id: agentId,
      site_id: siteId,
      check_in_lat: position.latitude,
      check_in_lng: position.longitude,
      check_in_distance_m: perimeter.distanceM,
      check_in_within_radius: perimeter.withinRadius,
    })
    .select(sessionColumns)
    .single();
  // The only caller-controlled unique value is the one-open-session agent key.
  if (error?.code === "23505") throw new OpenSessionConflictError();
  ensureQuerySucceeded(error);
  const session = decodeOwnedSession(data, agentId);
  if (session.site_id !== siteId || session.check_out_at !== null)
    throw new Error("Invalid inserted timekeeping session.");
  return session;
}

export async function closeSession(
  client: UserClient,
  agentId: string,
  sessionId: string,
  position: Position,
  perimeter: { distanceM: number; withinRadius: boolean },
): Promise<SessionRecord | null> {
  const { data, error } = await client
    .from("work_sessions")
    .update({
      check_out_at: new Date().toISOString(),
      check_out_lat: position.latitude,
      check_out_lng: position.longitude,
      check_out_distance_m: perimeter.distanceM,
      check_out_within_radius: perimeter.withinRadius,
    })
    .eq("id", sessionId)
    .eq("agent_id", agentId)
    .is("check_out_at", null)
    .select(sessionColumns)
    .maybeSingle();
  ensureQuerySucceeded(error);
  // Another request can close the same row after the initial ownership check.
  if (data === null) return null;
  const session = decodeOwnedSession(data, agentId);
  if (session.id !== sessionId || session.check_out_at === null)
    throw new Error("Invalid updated timekeeping session.");
  return session;
}
