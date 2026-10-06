import type { LoaderFunctionArgs } from "react-router";

import { handlePublicCreditNoteView } from "../models/public-document.server";

/**
 * GET /public/refund-documents/:token
 * Unauthenticated customer refund-document HTML (Group 13 Phase B).
 * Must NOT use authenticate.admin.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  return handlePublicCreditNoteView(
    String(params.token ?? ""),
    "refund_document",
  );
};
