import { badgeNumberSchema } from "./validation";

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
  return `${badgeNumberSchema.parse(badgeNumber)}@sentriq.local`;
}
