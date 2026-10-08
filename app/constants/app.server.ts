/**
 * Server-only app constants that read process.env.
 * Keep these out of app/constants/app.ts — that module is imported by client routes.
 */

/** Public support contact (support page, privacy contact, App Store listing). */
export const SUPPORT_EMAIL = (
  process.env.SUPPORT_MAIL ||
  process.env.SUPPORT_EMAIL ||
  "sbhattti1212@gmail.com"
).trim();

/** Public app base URL for absolute legal-page links (old shopify.appUrl). */
export function getPublicAppUrl(): string {
  const raw =
    process.env.SHOPIFY_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}
