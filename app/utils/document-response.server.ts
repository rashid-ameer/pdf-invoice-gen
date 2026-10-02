import { csvFilename } from "../utils/csv";

/** Build a downloadable CSV Response (Group 9 export — ignores UI filters). */
export function csvDownloadResponse(csv: string, prefix = "invoices"): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename(prefix)}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Build a PDF download Response. */
export function pdfDownloadResponse(
  pdf: Buffer,
  filenameBase: string,
): Response {
  const safe = filenameBase.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "invoice";
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safe}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

export function htmlDocumentResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
