/**
 * GET /app/print — Admin Print Action HTML (Group 15 Phase B).
 * Escapes `app.tsx` layout so App Home `authenticate.admin` is not required.
 * Auth: Phase A extension session token (Bearer or ?token=).
 * Does NOT record download events.
 */
import type { LoaderFunctionArgs } from "react-router";

import {
  buildOrderPrintHtml,
  normalizeShopifyOrderId,
  printErrorHtml,
  readPrintTypesFromRequest,
} from "../models/order-documents.server";
import {
  handleExtensionResource,
  htmlResponse,
} from "../models/extension-resource.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return handleExtensionResource(request, async (ctx) => {
    const url = new URL(request.url);
    const orderId = normalizeShopifyOrderId(url.searchParams.get("orderId"));
    if (!orderId) {
      return htmlResponse(printErrorHtml("Missing or invalid orderId"), 400);
    }

    const types = readPrintTypesFromRequest(request);
    if (!types.length) {
      return htmlResponse(printErrorHtml("Missing or empty types"), 400);
    }

    const printTypeRaw =
      url.searchParams.get("types") ?? url.searchParams.get("printType");

    try {
      const result = await buildOrderPrintHtml(
        ctx.shop,
        orderId,
        printTypeRaw,
      );
      if (!result.ok) {
        return htmlResponse(
          printErrorHtml(result.error),
          result.status ?? 404,
        );
      }
      return htmlResponse(result.html, 200);
    } catch (error) {
      console.error("[order-documents] print error:", error);
      return htmlResponse(
        printErrorHtml("Failed to render print document"),
        500,
      );
    }
  });
};
