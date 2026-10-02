import type { LoaderFunctionArgs } from "react-router";

import {
  exportAllInvoicesForShop,
  invoicesToCsv,
} from "../models/invoice-list.server";
import { authenticate } from "../shopify.server";
import { csvDownloadResponse } from "../utils/document-response.server";

/**
 * GET /app/packing-slips/export/csv
 * Same invoice rows as invoices export; packing-slip CSV columns (old kind=packing-slips).
 * Exports ALL shop invoices (ignores UI filters). Cap 5,000.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const exported = await exportAllInvoicesForShop(session.shop);
  if (!exported) {
    throw new Response("Store not found", { status: 404 });
  }
  return csvDownloadResponse(
    invoicesToCsv(exported.items, "packing-slips"),
    "packing-slips",
  );
};
