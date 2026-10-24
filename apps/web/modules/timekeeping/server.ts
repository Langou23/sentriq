import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/modules/auth/server";
import { timekeepingError } from "./errors";
import {
  readAssignedSites,
  readLastClosedSession,
  readOpenSession,
  readSite,
  summarizeSession,
  summarizeSite,
  type SiteRecord,
} from "./repository";
import type { AgentWorkspaceResponse } from "./types";

export async function getAgentWorkspace(): Promise<AgentWorkspaceResponse> {
  const profile = await requireProfile("agent");

  try {
    const client = await createClient();
    const [sites, openSession, lastClosedSession] = await Promise.all([
      readAssignedSites(client, profile.id),
      readOpenSession(client, profile.id),
      readLastClosedSession(client, profile.id),
    ]);
    const assignedSites = new Map(sites.map((site) => [site.id, site]));
    const siteReads = new Map<string, Promise<SiteRecord | null>>();

    // This lookup is request-local; identity and site state are never cached.
    function sessionSite(siteId: string): Promise<SiteRecord | null> {
      const assigned = assignedSites.get(siteId);
      if (assigned) return Promise.resolve(assigned);
      const pending = siteReads.get(siteId);
      if (pending) return pending;
      const read = readSite(client, siteId);
      siteReads.set(siteId, read);
      return read;
    }

    const [openSite, lastClosedSite] = await Promise.all([
      openSession ? sessionSite(openSession.site_id) : Promise.resolve(null),
      lastClosedSession
        ? sessionSite(lastClosedSession.site_id)
        : Promise.resolve(null),
    ]);
    if (openSession && !openSite)
      throw new Error("The open session site is unavailable.");

    return {
      profile,
      result: {
        success: true,
        data: {
          sites: sites.map(summarizeSite),
          openSession: openSession
            ? summarizeSession(openSession, openSite)
            : null,
          lastClosedSession: lastClosedSession
            ? summarizeSession(lastClosedSession, lastClosedSite)
            : null,
          serverNow: new Date().toISOString(),
        },
      },
    };
  } catch {
    // Query failures must not be presented as an agent having no assignments.
    return { profile, result: timekeepingError("service_unavailable") };
  }
}
