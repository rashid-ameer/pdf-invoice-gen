/**
 * GET /privacy — public privacy policy (Group 17 Phase 3).
 * No Shopify session or App Home auth required.
 */
import {
  legalHtmlResponse,
  renderPrivacyPage,
} from "../models/legal-pages.server";

export const loader = async () => {
  return legalHtmlResponse(renderPrivacyPage());
};
