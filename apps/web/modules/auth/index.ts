export type { AuthActionError, AuthErrorCode } from "./types";

export function badgeNumberToEmail(badgeNumber: string): string {
  return `${badgeNumber.trim().toUpperCase()}@sentriq.local`;
}
