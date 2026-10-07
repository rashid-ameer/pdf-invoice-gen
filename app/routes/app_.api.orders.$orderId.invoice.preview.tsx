/**
 * GET /app/api/orders/:orderId/invoice/preview — invoice HTML preview (G15 Phase B).
 * Group 7 render only — no download events.
 */
import type { LoaderFunctionArgs } from "react-router";

import {
  buildOrderInvoicePreviewHtml,
  normalizeShopifyOrderId,
  printErrorHtml,
} from "../models/order-documents.server";
import {
  handleExtensionResource,
  htmlResponse,
  jsonResponse,
} from "../models/extension-resource.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  return handleExtensionResource(request, async (ctx) => {
    const url = new URL(request.url);
    const orderId = normalizeShopifyOrderId(
      url.searchParams.get("orderId") || params.orderId,
    );
    if (!orderId) {
      return htmlResponse(printErrorHtml("Invalid order id"), 400);
    }

    try {
      const result = await buildOrderInvoicePreviewHtml(ctx.shop, orderId);
      if (!result.ok) {
        return htmlResponse(printErrorHtml(result.error), 404);
      }
      return htmlResponse(result.html, 200);
    } catch (error) {
      console.error("[order-documents] preview error:", error);
      return jsonResponse({ error: "Failed to render preview" }, 500);
    }
  });
};
