/**
 * GET /app/api/orders/:orderId/invoice/preview-image
 * A4 invoice thumbnail (JPEG/SVG) for Admin block/action inline preview.
 * Old parity: `/app/api/orders/preview-image`.
 */
import type { LoaderFunctionArgs } from "react-router";

import {
  buildOrderInvoicePreviewImage,
  normalizeShopifyOrderId,
} from "../models/order-documents.server";
import {
  binaryResponse,
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
      const result = await buildOrderInvoicePreviewImage(ctx.shop, orderId);
      if (!result.ok) {
        return jsonResponse({ error: result.error }, 404);
      }

      const buffer = Buffer.from(result.imageBase64, "base64");
      return binaryResponse(buffer, result.mimeType);
    } catch (error) {
      console.error("[order-documents] preview-image error:", error);
      return jsonResponse({ error: "Failed to render preview" }, 500);
    }
  });
};
