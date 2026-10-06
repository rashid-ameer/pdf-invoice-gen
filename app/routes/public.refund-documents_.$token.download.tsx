import type { LoaderFunctionArgs } from "react-router";

import { handlePublicCreditNoteDownload } from "../models/public-document.server";

/**
 * GET /public/refund-documents/:token/download
 * Unauthenticated customer refund-document PDF. No download/status events.
 * Must NOT use authenticate.admin.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  return handlePublicCreditNoteDownload(
    String(params.token ?? ""),
    "refund_document",
  );
};
