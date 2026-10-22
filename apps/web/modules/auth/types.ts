export type AuthMessage = { fr: string; en: string };

export type AuthFieldErrors = Partial<
  Record<"badgeNumber" | "password", AuthMessage>
>;

export type AuthErrorCode =
  | "invalid_input"
  | "invalid_credentials"
  | "account_disabled"
  | "service_unavailable";

export type AuthActionError = {
  success: false;
  code: AuthErrorCode;
  message: AuthMessage;
  fieldErrors?: AuthFieldErrors;
};
