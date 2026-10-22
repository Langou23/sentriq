export type {
  AuthActionError,
  AuthErrorCode,
  AuthFieldErrors,
  AuthMessage,
  AuthProfile,
  UserRole,
} from "./types";
export { validateSignIn } from "./validation";

export function badgeNumberToEmail(badgeNumber: string): string {
  return `${badgeNumber.trim().toUpperCase()}@sentriq.local`;
}
