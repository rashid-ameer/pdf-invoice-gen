/**
 * GET /app/api/orders/:orderId/documents — extension document summary (G15 Phase B).
 */
import type { LoaderFunctionArgs } from "react-router";

import {
  getOrderDocumentsSummary,
  normalizeShopifyOrderId,
} from "../models/order-documents.server";
import {
  handleExtensionResource,
  jsonResponse,
} from "../models/extension-resource.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  return handleExtensionResource(request, async (ctx) => {
    const url = new URL(request.url);
    const orderId = normalizeShopifyOrderId(
      url.searchParams.get("orderId") || params.orderId,
    );
    if (!orderId) {
      return jsonResponse({ error: "Invalid order id" }, 400);
    }

    try {
      const summary = await getOrderDocumentsSummary(ctx.shop, orderId);
      if (!summary.ok) {
        return jsonResponse({ error: summary.error }, 404);
      }
      return jsonResponse(summary, 200);
    } catch (error) {
      console.error("[order-documents] summary error:", error);
      return jsonResponse({ error: "Failed to load order documents" }, 500);
    }
  });
};
