import { describe, expect, it } from "vitest";
import { checkInSchema, checkOutSchema } from "../validation";
import { timekeepingError } from "../errors";
import type { TimekeepingErrorCode } from "../types";

const id = "de000000-0000-4000-8000-000000000001";
const position = { latitude: 45.52, longitude: -73.58 };

describe("untrusted timekeeping inputs", () => {
  it("accepts finite numeric coordinates and the relevant UUID", () => {
    expect(checkInSchema.parse({ ...position, siteId: id })).toEqual({
      ...position,
      siteId: id,
    });
    expect(checkOutSchema.parse({ ...position, sessionId: id })).toEqual({
      ...position,
      sessionId: id,
    });
  });

  it.each([
    { latitude: 90, longitude: 180 },
    { latitude: -90, longitude: -180 },
    { latitude: 0, longitude: 0 },
  ])("accepts coordinate limits without truthiness checks: %j", (point) => {
    expect(checkInSchema.safeParse({ ...point, siteId: id }).success).toBe(
      true,
    );
  });

  it.each([
    { latitude: 90.01, longitude: 0 },
    { latitude: -90.01, longitude: 0 },
    { latitude: 0, longitude: 180.01 },
    { latitude: 0, longitude: -180.01 },
    { latitude: Number.NaN, longitude: 0 },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY },
    { latitude: Number.NEGATIVE_INFINITY, longitude: 0 },
    { latitude: "45.52", longitude: "-73.58" },
    { latitude: null, longitude: 0 },
    { longitude: 0 },
  ])("rejects invalid coordinates: %j", (point) => {
    expect(checkInSchema.safeParse({ ...point, siteId: id }).success).toBe(
      false,
    );
    expect(checkOutSchema.safeParse({ ...point, sessionId: id }).success).toBe(
      false,
    );
  });

  it.each([undefined, null, "", 1, [], {}, "not-a-uuid"])(
    "requires an actual site/session UUID: %j",
    (value) => {
      expect(
        checkInSchema.safeParse({ ...position, siteId: value }).success,
      ).toBe(false);
      expect(
        checkOutSchema.safeParse({ ...position, sessionId: value }).success,
      ).toBe(false);
    },
  );

  it.each([
    { agent_id: id },
    { agentId: id },
    { check_in_at: "2026-01-01T00:00:00Z" },
    { check_out_at: "2026-01-01T00:00:00Z" },
    { distanceM: 0 },
    { withinRadius: true },
    { radiusM: 10_000 },
  ])("refuses extra client-controlled authority fields: %j", (extra) => {
    expect(
      checkInSchema.safeParse({ ...position, siteId: id, ...extra }).success,
    ).toBe(false);
    expect(
      checkOutSchema.safeParse({ ...position, sessionId: id, ...extra })
        .success,
    ).toBe(false);
  });

  const codes: TimekeepingErrorCode[] = [
    "invalid_input",
    "not_assigned",
    "already_open",
    "session_closed",
    "no_open_session",
    "service_unavailable",
    "location_denied",
    "location_unavailable",
    "location_timeout",
    "location_unsupported",
  ];

  it.each(codes)("returns French and English for %s", (code) => {
    const error = timekeepingError(code);
    expect(error.success).toBe(false);
    expect(error.code).toBe(code);
    expect(error.message.fr.trim()).not.toBe("");
    expect(error.message.en.trim()).not.toBe("");
    expect(error.message.fr).not.toBe(error.message.en);
  });
});
