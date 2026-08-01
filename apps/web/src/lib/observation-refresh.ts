export function startObservationRefresh(
  refresh: () => void,
  intervalMs: number,
): () => void {
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) {
    throw new Error("Observation refresh interval must be between 1000 and 60000 milliseconds");
  }
  const timer = globalThis.setInterval(refresh, intervalMs);
  return () => globalThis.clearInterval(timer);
}
