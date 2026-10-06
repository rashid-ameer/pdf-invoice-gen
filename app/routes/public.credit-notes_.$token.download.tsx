import type { LoaderFunctionArgs } from "react-router";

import { handlePublicCreditNoteDownload } from "../models/public-document.server";

/**
 * GET /public/credit-notes/:token/download
 * Unauthenticated customer credit-note PDF. No download/status events.
 * Must NOT use authenticate.admin.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  return handlePublicCreditNoteDownload(
    String(params.token ?? ""),
    "credit_note",
  );
};
