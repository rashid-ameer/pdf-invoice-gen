/** Product name used in merchant-facing emails and titles (old APP_NAME). */
export const APP_NAME = "PDF Invoice Generator CG";

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

/** Default locale for dates and amounts in the admin UI. */
export const APP_LOCALE = "en-US";

/** Fallback currency when the store has none set. */
export const DEFAULT_CURRENCY = "USD";
