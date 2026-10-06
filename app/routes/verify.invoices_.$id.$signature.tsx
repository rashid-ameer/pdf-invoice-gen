import type { LoaderFunctionArgs } from "react-router";

import { verificationHttpResponse } from "../models/document-verification.server";
import { verifyInvoiceDocument } from "../models/verification.server";

/**
 * GET /verify/invoices/:id/:signature
 * Public integrity verification (Group 13 Phase C). No authenticate.admin.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  try {
    const result = await verifyInvoiceDocument(
      String(params.id ?? ""),
      String(params.signature ?? ""),
    );
    return verificationHttpResponse(result);
  } catch (error) {
    console.error("[verify] invoice error:", error);
    return new Response("Failed to verify document", { status: 500 });
  }
};
