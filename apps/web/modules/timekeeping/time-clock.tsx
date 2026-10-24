"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { AuthMessage } from "@/modules/auth";
import { checkIn, checkOut } from "./actions";
import { timekeepingError } from "./errors";
import type {
  AgentWorkspaceData,
  AgentWorkspaceResult,
  Position,
  SiteSummary,
  TimekeepingActionResult,
  TimekeepingErrorCode,
  TimekeepingFailure,
  WorkSession,
} from "./types";

type SuccessfulAction = Extract<TimekeepingActionResult, { success: true }>;
type ActionPhase = "locating" | "saving" | null;

class LocationRequestError extends Error {
  constructor(readonly code: TimekeepingErrorCode) {
    super(code);
    this.name = "LocationRequestError";
  }
}

function requestPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationRequestError("location_unsupported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude, longitude } = coords;
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          reject(new LocationRequestError("location_unavailable"));
          return;
        }
        resolve({ latitude, longitude });
      },
      (error) => {
        const code =
          error.code === 1
            ? "location_denied"
            : error.code === 3
              ? "location_timeout"
              : "location_unavailable";
        reject(new LocationRequestError(code));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

function MessageText({ message }: { message: AuthMessage }) {
  return (
    <span className="block">
      <span className="block">{message.fr}</span>
      <span lang="en" className="mt-1 block text-sm font-normal">
        {message.en}
      </span>
    </span>
  );
}

function formatTimestamp(value: string, locale: "fr-CA" | "en-CA"): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}

function SessionTime({ value }: { value: string }) {
  return (
    <time dateTime={value} className="mt-1 block font-medium">
      <span className="block">
        {formatTimestamp(value, "fr-CA")} — heure du Québec
      </span>
      <span
        lang="en"
        className="mt-1 block text-sm font-normal text-muted-foreground"
      >
        {formatTimestamp(value, "en-CA")} — Quebec time
      </span>
    </time>
  );
}

function ElapsedTime({
  startedAt,
  serverNow,
}: {
  startedAt: string;
  serverNow: string;
}) {
  const [clock, setClock] = useState(() => ({
    source: serverNow,
    now: Date.parse(serverNow),
  }));

  useEffect(() => {
    const initialNow = Date.parse(serverNow);
    const baseline = performance.now();
    const interval = window.setInterval(() => {
      setClock({
        source: serverNow,
        now: initialNow + performance.now() - baseline,
      });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [serverNow]);

  const now = clock.source === serverNow ? clock.now : Date.parse(serverNow);
  const seconds = Math.max(
    0,
    Math.floor((now - Date.parse(startedAt)) / 1_000),
  );
  const hours = String(Math.floor(seconds / 3_600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3_600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");

  return (
    <output
      aria-live="off"
      aria-label="Durée du poste / Shift duration"
      className="mt-2 block text-4xl font-semibold tabular-nums tracking-tight"
    >
      {hours}:{minutes}:{remainder}
    </output>
  );
}

function SiteDetails({ site }: { site: SiteSummary | null }) {
  return (
    <div className="space-y-1">
      <p className="break-words text-lg font-semibold">
        {site ? (
          site.name
        ) : (
          <>
            Site indisponible <span lang="en">/ Site unavailable</span>
          </>
        )}
      </p>
      {site?.address ? (
        <p className="break-words text-sm text-muted-foreground">
          {site.address}
        </p>
      ) : null}
    </div>
  );
}

function PerimeterNotice({ session }: { session: WorkSession }) {
  const outsideAtStart = session.checkInWithinRadius === false;
  const outsideAtEnd = session.checkOutWithinRadius === false;
  if (!outsideAtStart && !outsideAtEnd) return null;

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="inline-flex rounded-full border border-amber-400 px-2.5 py-1 text-xs font-semibold dark:border-amber-600">
        Signalé{" "}
        <span lang="en" className="ml-1">
          / Flagged
        </span>
      </p>
      {outsideAtStart ? (
        <p>
          <MessageText
            message={{
              fr: "Début du poste hors périmètre",
              en: "Shift started outside the site perimeter",
            }}
          />
        </p>
      ) : null}
      {outsideAtEnd ? (
        <p>
          <MessageText
            message={{
              fr: "Fin du poste hors périmètre",
              en: "Shift ended outside the site perimeter",
            }}
          />
        </p>
      ) : null}
    </div>
  );
}

function RefreshLabel({ pending }: { pending: boolean }) {
  return (
    <MessageText
      message={
        pending
          ? { fr: "Actualisation en cours…", en: "Refreshing…" }
          : { fr: "Actualiser la page", en: "Refresh the page" }
      }
    />
  );
}

function WorkspaceFailure({ failure }: { failure: TimekeepingFailure }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      aria-busy={pending}
    >
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        <MessageText message={failure.message} />
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
        className="h-auto min-h-11 w-full py-3"
      >
        <RefreshLabel pending={pending} />
      </Button>
    </section>
  );
}

function TimeClockContent({ data }: { data: AgentWorkspaceData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const requestMutex = useRef(false);
  const [phase, setPhase] = useState<ActionPhase>(null);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [failure, setFailure] = useState<TimekeepingFailure | null>(null);
  const [notice, setNotice] = useState<AuthMessage | null>(null);
  const [localUpdate, setLocalUpdate] = useState<{
    snapshot: string;
    action: SuccessfulAction;
  } | null>(null);

  // Keep the synchronous lock through GPS, the server mutation and refresh.
  useEffect(() => {
    if (!pending) requestMutex.current = false;
  }, [pending]);

  const action =
    localUpdate?.snapshot === data.serverNow ? localUpdate.action : null;
  const openSession = action
    ? action.operation === "check_in"
      ? action.session
      : null
    : data.openSession;
  const lastClosedSession =
    action?.operation === "check_out" ? action.session : data.lastClosedSession;
  const selectedSite =
    data.sites.length === 1
      ? data.sites[0]
      : data.sites.find((site) => site.id === selectedSiteId);
  const pendingMessage: AuthMessage =
    phase === "locating"
      ? { fr: "Localisation en cours…", en: "Getting your location…" }
      : phase === "saving"
        ? { fr: "Pointage en cours…", en: "Recording your shift…" }
        : { fr: "Actualisation en cours…", en: "Refreshing…" };

  function refreshWorkspace() {
    if (requestMutex.current || pending) return;
    requestMutex.current = true;
    setFailure(null);
    startTransition(() => router.refresh());
  }

  function recordShift() {
    if (requestMutex.current || pending || (!openSession && !selectedSite))
      return;
    requestMutex.current = true;
    setFailure(null);
    setNotice(null);
    setPhase("locating");

    startTransition(async () => {
      try {
        const position = await requestPosition();
        setPhase("saving");
        const result = openSession
          ? await checkOut({ sessionId: openSession.id, ...position })
          : await checkIn({ siteId: selectedSite?.id, ...position });
        if (!result.success) {
          setFailure(result);
          return;
        }
        setLocalUpdate({ snapshot: data.serverNow, action: result });
        setNotice(
          result.operation === "check_in"
            ? {
                fr: "Votre prise de poste est enregistrée.",
                en: "Your shift start has been recorded.",
              }
            : {
                fr: "Votre fin de poste est enregistrée.",
                en: "Your shift end has been recorded.",
              },
        );
        startTransition(() => router.refresh());
      } catch (error: unknown) {
        setFailure(
          timekeepingError(
            error instanceof LocationRequestError
              ? error.code
              : "service_unavailable",
          ),
        );
      } finally {
        setPhase(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="shift-title"
        aria-busy={pending}
        className="space-y-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <h2 id="shift-title" className="text-xl font-semibold">
          {openSession ? "Poste en cours" : "Prise de poste"}
          <span
            lang="en"
            className="mt-1 block text-base font-normal text-muted-foreground"
          >
            {openSession ? "Current shift" : "Start a shift"}
          </span>
        </h2>

        {openSession ? (
          <>
            <SiteDetails site={openSession.site} />
            <dl className="space-y-5">
              <div>
                <dt className="text-sm text-muted-foreground">
                  Début <span lang="en">/ Started</span>
                </dt>
                <dd>
                  <SessionTime value={openSession.checkInAt} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  Durée écoulée <span lang="en">/ Elapsed time</span>
                </dt>
                <dd>
                  <ElapsedTime
                    startedAt={openSession.checkInAt}
                    serverNow={data.serverNow}
                  />
                </dd>
              </div>
            </dl>
            <PerimeterNotice session={openSession} />
          </>
        ) : data.sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <MessageText
              message={{
                fr: "Aucun site affecté, contactez votre superviseur.",
                en: "No site assigned. Contact your supervisor.",
              }}
            />
          </p>
        ) : data.sites.length === 1 ? (
          <SiteDetails site={data.sites[0]} />
        ) : (
          <fieldset disabled={pending} className="space-y-3">
            <legend className="mb-3 text-sm font-medium">
              Site de prise de poste{" "}
              <span
                lang="en"
                className="mt-1 block font-normal text-muted-foreground"
              >
                Shift site
              </span>
            </legend>
            {data.sites.map((site) => (
              <label
                key={site.id}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-4 has-[:checked]:border-ring has-[:checked]:bg-muted/50"
              >
                <input
                  type="radio"
                  name="shift-site"
                  value={site.id}
                  checked={selectedSiteId === site.id}
                  onChange={() => setSelectedSiteId(site.id)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 space-y-1">
                  <span className="block break-words font-medium">
                    {site.name}
                  </span>
                  {site.address ? (
                    <span className="block break-words text-sm text-muted-foreground">
                      {site.address}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {failure ? (
          <div
            role="alert"
            className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <MessageText message={failure.message} />
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={refreshWorkspace}
              className="h-auto min-h-11 w-full py-3 text-foreground"
            >
              <RefreshLabel pending={pending} />
            </Button>
          </div>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="rounded-lg border bg-muted/50 p-3 text-sm"
          >
            <MessageText message={notice} />
          </p>
        ) : null}

        {openSession || data.sites.length > 0 ? (
          <div className="space-y-3">
            <Button
              type="button"
              onClick={recordShift}
              disabled={pending || (!openSession && !selectedSite)}
              className="h-auto min-h-14 w-full px-4 py-4 text-base"
            >
              <MessageText
                message={
                  pending
                    ? pendingMessage
                    : openSession
                      ? { fr: "Terminer mon poste", en: "End my shift" }
                      : { fr: "Prendre mon poste", en: "Start my shift" }
                }
              />
            </Button>
            {pending ? (
              <p role="status" className="text-sm text-muted-foreground">
                <MessageText message={pendingMessage} />
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              <MessageText
                message={{
                  fr: "Votre position est demandée uniquement lorsque vous prenez ou terminez votre poste.",
                  en: "Your location is requested only when you start or end your shift.",
                }}
              />
            </p>
          </div>
        ) : null}
      </section>

      {lastClosedSession ? (
        <section
          aria-labelledby="last-shift-title"
          className="space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6"
        >
          <h2 id="last-shift-title" className="text-lg font-semibold">
            Dernier poste terminé{" "}
            <span
              lang="en"
              className="mt-1 block text-base font-normal text-muted-foreground"
            >
              Last completed shift
            </span>
          </h2>
          <SiteDetails site={lastClosedSession.site} />
          <dl className="space-y-4">
            <div>
              <dt className="text-sm text-muted-foreground">
                Début <span lang="en">/ Started</span>
              </dt>
              <dd>
                <SessionTime value={lastClosedSession.checkInAt} />
              </dd>
            </div>
            {lastClosedSession.checkOutAt ? (
              <div>
                <dt className="text-sm text-muted-foreground">
                  Fin enregistrée <span lang="en">/ End recorded</span>
                </dt>
                <dd>
                  <SessionTime value={lastClosedSession.checkOutAt} />
                </dd>
              </div>
            ) : null}
          </dl>
          <PerimeterNotice session={lastClosedSession} />
        </section>
      ) : null}
    </div>
  );
}

export function TimeClock({ result }: { result: AgentWorkspaceResult }) {
  return result.success ? (
    <TimeClockContent data={result.data} />
  ) : (
    <WorkspaceFailure failure={result} />
  );
}
