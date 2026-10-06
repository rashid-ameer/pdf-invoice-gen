import type { LoaderFunctionArgs } from "react-router";

import { handlePublicInvoiceView } from "../models/public-document.server";

/**
 * GET /public/invoices/:token
 * Unauthenticated customer invoice HTML (Group 13 Phase B).
 * Must NOT use authenticate.admin.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  return handlePublicInvoiceView(String(params.token ?? ""));
};
