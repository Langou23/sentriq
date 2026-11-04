import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElapsedClock } from "../elapsed-clock";

const serverNow = "2026-11-04T14:00:00.000Z";
const serverTimestamp = Date.parse(serverNow);

describe("server-anchored elapsed clock", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(serverNow));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(["2000-01-01T00:00:00.000Z", "2040-01-01T00:00:00.000Z"])(
    "starts at server time even when the device clock reads %s",
    (deviceNow) => {
      vi.setSystemTime(new Date(deviceNow));
      const readNow = createElapsedClock(serverNow);

      expect(readNow()).toBe(serverTimestamp);
      vi.advanceTimersByTime(5_000);
      expect(readNow()).toBe(serverTimestamp + 5_000);
    },
  );

  it("advances normally from the server anchor", () => {
    const readNow = createElapsedClock(serverNow);

    vi.advanceTimersByTime(1_000);
    expect(readNow()).toBe(serverTimestamp + 1_000);
    vi.advanceTimersByTime(59_000);
    expect(readNow()).toBe(serverTimestamp + 60_000);
  });

  it("includes a long sleep without timer callbacks or a ticking performance clock", () => {
    const frozenPerformance = vi.spyOn(performance, "now").mockReturnValue(123);
    const callback = vi.fn();
    setTimeout(callback, 1_000);
    const readNow = createElapsedClock(serverNow);
    const sleepDuration = 8 * 60 * 60 * 1_000;

    vi.setSystemTime(Date.now() + sleepDuration);

    expect(callback).not.toHaveBeenCalled();
    expect(frozenPerformance()).toBe(123);
    expect(readNow()).toBe(serverTimestamp + sleepDuration);
  });

  it("uses a fresh server anchor after a workspace refresh", () => {
    const previousClock = createElapsedClock(serverNow);
    vi.advanceTimersByTime(10_000);
    const refreshedServerNow = "2026-11-04T14:00:08.000Z";
    const refreshedClock = createElapsedClock(refreshedServerNow);

    expect(previousClock()).toBe(serverTimestamp + 10_000);
    expect(refreshedClock()).toBe(Date.parse(refreshedServerNow));
    vi.advanceTimersByTime(2_000);
    expect(refreshedClock()).toBe(serverTimestamp + 10_000);
  });

  it("does not move before the server anchor if the device clock moves backward", () => {
    const readNow = createElapsedClock(serverNow);

    vi.setSystemTime(Date.now() - 60_000);

    expect(readNow()).toBe(serverTimestamp);
  });
});
