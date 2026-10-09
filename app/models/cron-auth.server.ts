/**
 * Shared cron endpoint auth (Genie-style Bearer CRON_SECRET).
 * Used by Upsell timer reverts and any future scheduled jobs.
 */
export function authorizeCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[cron] CRON_SECRET is required in production');
      return false;
    }
    console.warn('[cron] CRON_SECRET not set — allowing in non-production');
    return true;
  }

  const auth = request.headers.get('Authorization');
  return auth === `Bearer ${secret}`;
}
