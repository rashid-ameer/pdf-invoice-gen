/** True when a client request never got a usable response (tunnel/offline/abort). */
export function isNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "TypeError" && /failed to fetch/i.test(error.message)
  );
}
