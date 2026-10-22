export type AuthErrorCode =
  "invalid_input" | "invalid_credentials" | "service_unavailable";

export type AuthActionError = {
  success: false;
  code: AuthErrorCode;
  message: {
    fr: string;
    en: string;
  };
};
