"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/modules/auth/server";
import { timekeepingError } from "./errors";
import { measurePerimeter } from "./geo";
import {
  closeSession,
  insertSession,
  OpenSessionConflictError,
  readAssignedSite,
  readOpenSession,
  readOwnedSession,
  readSite,
  summarizeSession,
} from "./repository";
import type { TimekeepingActionResult, WorkSession } from "./types";
import { checkInSchema, checkOutSchema } from "./validation";

export async function checkIn(
  input: unknown,
): Promise<TimekeepingActionResult> {
  // Redirects from the public auth guard must propagate outside the error catch.
  const profile = await requireProfile("agent");
  const parsed = checkInSchema.safeParse(input);
  if (!parsed.success) return timekeepingError("invalid_input");

  let session: WorkSession;
  try {
    const client = await createClient({ requireCookieWrites: true });
    if (await readOpenSession(client, profile.id))
      return timekeepingError("already_open");

    const site = await readAssignedSite(client, profile.id, parsed.data.siteId);
    if (!site) return timekeepingError("not_assigned");
    const position = {
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
    };
    const perimeter = measurePerimeter(position, {
      latitude: site.latitude,
      longitude: site.longitude,
      radiusM: site.radius_m,
    });
    const row = await insertSession(
      client,
      profile.id,
      site.id,
      position,
      perimeter,
    );
    session = summarizeSession(row, site);
  } catch (error) {
    return timekeepingError(
      error instanceof OpenSessionConflictError
        ? "already_open"
        : "service_unavailable",
    );
  }

  revalidatePath("/agent");
  return { success: true, operation: "check_in", session };
}

export async function checkOut(
  input: unknown,
): Promise<TimekeepingActionResult> {
  const profile = await requireProfile("agent");
  const parsed = checkOutSchema.safeParse(input);
  if (!parsed.success) return timekeepingError("invalid_input");

  let session: WorkSession;
  try {
    const client = await createClient({ requireCookieWrites: true });
    const currentSession = await readOwnedSession(
      client,
      profile.id,
      parsed.data.sessionId,
    );
    if (!currentSession) return timekeepingError("no_open_session");
    if (currentSession.check_out_at !== null)
      return timekeepingError("session_closed");

    // A deactivated site or assignment must not strand an already-open session.
    const site = await readSite(client, currentSession.site_id);
    if (!site) return timekeepingError("service_unavailable");
    const position = {
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
    };
    const perimeter = measurePerimeter(position, {
      latitude: site.latitude,
      longitude: site.longitude,
      radiusM: site.radius_m,
    });
    const row = await closeSession(
      client,
      profile.id,
      currentSession.id,
      position,
      perimeter,
    );
    if (!row) return timekeepingError("session_closed");
    session = summarizeSession(row, site);
  } catch {
    return timekeepingError("service_unavailable");
  }

  revalidatePath("/agent");
  return { success: true, operation: "check_out", session };
}
