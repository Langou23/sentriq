import { describe, expect, it } from "vitest";
import { haversineDistanceM, measurePerimeter } from "../geo";

describe("server perimeter measurements", () => {
  it("has zero distance for identical Montreal coordinates", () => {
    const point = { latitude: 45.52, longitude: -73.58 };
    expect(haversineDistanceM(point, point)).toBe(0);
    expect(measurePerimeter(point, { ...point, radiusM: 150 })).toEqual({
      distanceM: 0,
      withinRadius: true,
    });
  });

  it("measures one equatorial degree in meters", () => {
    expect(
      haversineDistanceM(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ),
    ).toBeCloseTo(111_194.926645, 5);
  });

  it("takes the short route across the international date line", () => {
    expect(
      haversineDistanceM(
        { latitude: 0, longitude: 179.999 },
        { latitude: 0, longitude: -179.999 },
      ),
    ).toBeCloseTo(222.389853, 4);
  });

  it("keeps antipodal distances finite despite floating-point drift", () => {
    expect(
      haversineDistanceM(
        { latitude: 90, longitude: 0 },
        { latitude: -90, longitude: 180 },
      ),
    ).toBeCloseTo(20_015_086.796, 2);
  });

  it("is symmetric and separates the two Montreal demo sites", () => {
    const first = { latitude: 45.52, longitude: -73.58 };
    const second = { latitude: 45.54, longitude: -73.62 };
    const distance = haversineDistanceM(first, second);
    expect(distance).toBeGreaterThan(3_700);
    expect(distance).toBeLessThan(4_000);
    expect(haversineDistanceM(second, first)).toBeCloseTo(distance, 8);
    expect(
      measurePerimeter(first, { ...second, radiusM: 150 }).withinRadius,
    ).toBe(false);
  });

  it("flags an outside position before rounding the stored integer distance", () => {
    expect(
      measurePerimeter(
        { latitude: 0.00135, longitude: 0 },
        { latitude: 0, longitude: 0, radiusM: 150 },
      ),
    ).toEqual({ distanceM: 150, withinRadius: false });
  });

  it("includes the perimeter boundary", () => {
    const first = { latitude: 45.52, longitude: -73.58 };
    const second = { latitude: 45.521, longitude: -73.58 };
    const radiusM = haversineDistanceM(first, second);
    expect(measurePerimeter(first, { ...second, radiusM }).withinRadius).toBe(
      true,
    );
  });
});
