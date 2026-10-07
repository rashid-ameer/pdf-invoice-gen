/**
 * GET /support — public support page (Group 17 Phase 3).
 * No Shopify session or App Home auth required.
 */
import {
  legalHtmlResponse,
  renderSupportPage,
} from "../models/legal-pages.server";

export const loader = async () => {
  return legalHtmlResponse(renderSupportPage());
};
