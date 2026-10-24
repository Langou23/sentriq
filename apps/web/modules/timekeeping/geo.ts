import type { Position } from "./types";

const earthRadiusM = 6_371_000;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineDistanceM(from: Position, to: Position): number {
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  // Clamp floating-point drift at coincident/antipodal coordinates.
  return earthRadiusM * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}

export function measurePerimeter(
  position: Position,
  site: Position & { radiusM: number },
): { distanceM: number; withinRadius: boolean } {
  const distance = haversineDistanceM(position, site);
  return {
    distanceM: Math.round(distance),
    withinRadius: distance <= site.radiusM,
  };
}
