import type { LoaderFunctionArgs } from "react-router";

import {
  renderPackingSlipsBulk,
  BULK_INVOICE_LIMIT,
} from "../models/invoice-document.server";
import {
  applyA4DocumentLayout,
  wrapA4PreviewHtml,
} from "../models/document-preview.server";
import { authenticate } from "../shopify.server";
import { htmlDocumentResponse } from "../utils/document-response.server";

/**
 * GET /app/packing-slips/bulk?ids=…&templateId=…&mode=preview&embed=1
 * Bulk packing-slip HTML for browser print. Cap 50 (old packing-slips bulk).
 * Does not record packing_slip_downloaded (print/preview path).
 * No bulk PDF download.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const invoiceIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const templateId = url.searchParams.get("templateId") ?? undefined;
  const embed = url.searchParams.get("embed") === "1";
  const modeParam = url.searchParams.get("mode");
  const mode = modeParam ?? (embed ? "preview" : "preview");

  if (invoiceIds.length === 0) {
    throw new Response("Select at least one order", { status: 400 });
  }
  if (invoiceIds.length > BULK_INVOICE_LIMIT) {
    throw new Response("You can print up to 50 packing slips at once", {
      status: 400,
    });
  }

  const bulk = await renderPackingSlipsBulk(
    session.shop,
    invoiceIds,
    templateId,
  );
  if (!bulk) {
    throw new Response("No packing slips found for the selected orders", {
      status: 404,
    });
  }

  const laidOut = applyA4DocumentLayout(bulk.html);
  if (embed || mode === "print" || mode === "preview") {
    return htmlDocumentResponse(laidOut);
  }
  return htmlDocumentResponse(wrapA4PreviewHtml(laidOut));
};
