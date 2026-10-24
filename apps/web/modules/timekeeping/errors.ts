import type { AuthMessage } from "@/modules/auth";
import type { TimekeepingErrorCode, TimekeepingFailure } from "./types";

const messages: Record<TimekeepingErrorCode, AuthMessage> = {
  invalid_input: {
    fr: "Site, session ou position invalide. Actualisez la page et réessayez.",
    en: "Invalid site, session or position. Refresh the page and try again.",
  },
  not_assigned: {
    fr: "Ce site ou votre affectation n’est plus disponible. Contactez votre superviseur.",
    en: "This site or your assignment is no longer available. Contact your supervisor.",
  },
  already_open: {
    fr: "Une session est déjà ouverte. Actualisez la page pour terminer votre poste.",
    en: "A session is already open. Refresh the page to end your shift.",
  },
  session_closed: {
    fr: "Cette session est déjà terminée. Actualisez la page.",
    en: "This session has already ended. Refresh the page.",
  },
  no_open_session: {
    fr: "Aucune session ouverte trouvée. Actualisez la page.",
    en: "No open session was found. Refresh the page.",
  },
  service_unavailable: {
    fr: "Le pointage est indisponible. Actualisez la page ou réessayez plus tard.",
    en: "Timekeeping is unavailable. Refresh the page or try again later.",
  },
  location_denied: {
    fr: "Permission de localisation refusée. Autorisez la localisation dans votre navigateur, puis réessayez.",
    en: "Location permission denied. Allow location access in your browser, then try again.",
  },
  location_unavailable: {
    fr: "Position indisponible. Vérifiez que la localisation est activée et réessayez.",
    en: "Your position is unavailable. Check that location is enabled and try again.",
  },
  location_timeout: {
    fr: "La localisation a pris trop de temps. Réessayez dans un endroit où le signal est meilleur.",
    en: "Location timed out. Try again where the signal is stronger.",
  },
  location_unsupported: {
    fr: "La localisation est indisponible dans ce navigateur. Utilisez un navigateur compatible sur une connexion sécurisée.",
    en: "Location is unavailable in this browser. Use a supported browser on a secure connection.",
  },
};

export function timekeepingError(
  code: TimekeepingErrorCode,
): TimekeepingFailure {
  return { success: false, code, message: messages[code] };
}
