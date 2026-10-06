import type { LoaderFunctionArgs } from "react-router";

import { handlePublicCreditNoteView } from "../models/public-document.server";

/**
 * GET /public/credit-notes/:token
 * Unauthenticated customer credit-note HTML (Group 13 Phase B).
 * Must NOT use authenticate.admin.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  return handlePublicCreditNoteView(String(params.token ?? ""), "credit_note");
};
