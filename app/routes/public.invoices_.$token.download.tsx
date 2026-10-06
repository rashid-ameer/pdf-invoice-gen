import type { LoaderFunctionArgs } from "react-router";

import { handlePublicInvoiceDownload } from "../models/public-document.server";

/**
 * GET /public/invoices/:token/download
 * Unauthenticated customer invoice PDF. No download/status events.
 * Must NOT use authenticate.admin.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  return handlePublicInvoiceDownload(String(params.token ?? ""));
};
