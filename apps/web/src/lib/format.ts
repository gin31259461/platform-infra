export function formatAge(isoTimestamp: string | null, nowIsoTimestamp: string): string {
  if (isoTimestamp === null) return "Never observed";
  const milliseconds = Math.max(
    0,
    new Date(nowIsoTimestamp).getTime() - new Date(isoTimestamp).getTime(),
  );
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ago`;
}
