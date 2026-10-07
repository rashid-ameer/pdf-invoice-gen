/**
 * POST /app/api/orders/:orderId/invoice/customer-link — Group 13 issuer (G15 Phase B).
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  issueOrderInvoicePublicLink,
  normalizeShopifyOrderId,
} from "../models/order-documents.server";
import {
  handleExtensionResource,
  jsonResponse,
} from "../models/extension-resource.server";

async function resolveOrderId(
  request: Request,
  params: { orderId?: string },
): Promise<string | null> {
  const url = new URL(request.url);
  let bodyOrderId: string | null = null;
  if (request.method.toUpperCase() === "POST") {
    try {
      const cloned = request.clone();
      const contentType = cloned.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const body = (await cloned.json().catch(() => null)) as {
          orderId?: unknown;
        } | null;
        if (typeof body?.orderId === "string") bodyOrderId = body.orderId;
      }
    } catch {
      // ignore
    }
  }
  return normalizeShopifyOrderId(
    bodyOrderId || url.searchParams.get("orderId") || params.orderId,
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return handleExtensionResource(request, async () =>
    jsonResponse({ error: "Method not allowed" }, 405),
  );
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method.toUpperCase() !== "POST") {
    return handleExtensionResource(request, async () =>
      jsonResponse({ error: "Method not allowed" }, 405),
    );
  }

  return handleExtensionResource(request, async (ctx) => {
    const orderId = await resolveOrderId(request, params);
    if (!orderId) {
      return jsonResponse({ error: "Invalid order id" }, 400);
    }

    try {
      const result = await issueOrderInvoicePublicLink(ctx.shop, orderId);
      if (!result.ok) {
        const notFound =
          /not found|Store not found|Order not found/i.test(result.error) ||
          result.error === "Invalid order id";
        return jsonResponse(
          { error: result.error },
          notFound ? 404 : 502,
        );
      }
      return jsonResponse(
        {
          ok: true,
          url: result.url,
          expiresAt: result.expiresAt.toISOString(),
          invoiceNumber: result.invoiceNumber,
        },
        200,
      );
    } catch (error) {
      console.error("[order-documents] customer-link error:", error);
      return jsonResponse({ error: "Failed to create customer link" }, 502);
    }
  });
};
