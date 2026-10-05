import type { LoaderFunctionArgs } from "react-router";

import {
  creditNotesToCsv,
  exportCreditNotesForShop,
  parseCreditNoteListTab,
} from "../models/credit-note-list.server";
import { authenticate } from "../shopify.server";
import { csvDownloadResponse } from "../utils/document-response.server";

/**
 * GET /app/credit-notes/export/csv?kind=credit-notes|refund-documents
 * Exports ALL store credit notes (same rows for both kinds). Cap 5,000.
 * Old route used BOM-prefixed CSV — preserved.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const kind = parseCreditNoteListTab(url.searchParams.get("kind"));
  const prefix =
    kind === "refund-documents" ? "refund-documents" : "credit-notes";

  const exported = await exportCreditNotesForShop(session.shop);
  if (!exported) {
    throw new Response("Store not found", { status: 404 });
  }

  const csv = `\uFEFF${creditNotesToCsv(exported.items, kind)}`;
  return csvDownloadResponse(csv, prefix);
};
