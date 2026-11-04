export function createElapsedClock(serverNow: string): () => number {
  const serverTimestamp = Date.parse(serverNow);
  const deviceBaseline = Date.now();

  // Wall-clock deltas include device sleep, unlike performance.now() on some browsers.
  // The server anchor avoids depending on the device clock's initial accuracy.
  return () => serverTimestamp + Math.max(0, Date.now() - deviceBaseline);
}
