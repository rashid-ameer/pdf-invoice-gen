import type { LoaderFunctionArgs } from "react-router";

import { verificationHttpResponse } from "../models/document-verification.server";
import { verifyCreditNoteDocument } from "../models/verification.server";

/**
 * GET /verify/credit-notes/:id/:signature
 * Public integrity verification (Group 13 Phase C). No authenticate.admin.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  try {
    const result = await verifyCreditNoteDocument(
      String(params.id ?? ""),
      String(params.signature ?? ""),
      "credit_note",
    );
    return verificationHttpResponse(result);
  } catch (error) {
    console.error("[verify] credit note error:", error);
    return new Response("Failed to verify document", { status: 500 });
  }
};
