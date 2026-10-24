import type { AuthMessage, AuthProfile } from "@/modules/auth";

export type Position = { latitude: number; longitude: number };

export type SiteSummary = {
  id: string;
  name: string;
  address: string | null;
  radiusM: number;
};

export type WorkSession = {
  id: string;
  siteId: string;
  site: SiteSummary | null;
  checkInAt: string;
  checkInDistanceM: number | null;
  checkInWithinRadius: boolean | null;
  checkOutAt: string | null;
  checkOutDistanceM: number | null;
  checkOutWithinRadius: boolean | null;
};

export type AgentWorkspaceData = {
  sites: SiteSummary[];
  openSession: WorkSession | null;
  lastClosedSession: WorkSession | null;
  serverNow: string;
};

export type TimekeepingErrorCode =
  | "invalid_input"
  | "not_assigned"
  | "already_open"
  | "session_closed"
  | "no_open_session"
  | "service_unavailable"
  | "location_denied"
  | "location_unavailable"
  | "location_timeout"
  | "location_unsupported";

export type TimekeepingFailure = {
  success: false;
  code: TimekeepingErrorCode;
  message: AuthMessage;
};

export type TimekeepingActionResult =
  | {
      success: true;
      operation: "check_in" | "check_out";
      session: WorkSession;
    }
  | TimekeepingFailure;

export type AgentWorkspaceResult =
  { success: true; data: AgentWorkspaceData } | TimekeepingFailure;

export type AgentWorkspaceResponse = {
  profile: AuthProfile;
  result: AgentWorkspaceResult;
};
