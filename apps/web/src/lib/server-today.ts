import "server-only";

/** Today's date (UTC, YYYY-MM-DD) on the server, read after the request's dynamic data. */
export function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}
