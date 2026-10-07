/**
 * GET /install — public install guidance (Group 17 Phase 3).
 * No Shopify session or App Home auth required.
 * No custom shop-domain installation form.
 */
import {
  legalHtmlResponse,
  renderInstallFromShopifyPage,
} from "../models/legal-pages.server";

export const loader = async () => {
  return legalHtmlResponse(renderInstallFromShopifyPage());
};
