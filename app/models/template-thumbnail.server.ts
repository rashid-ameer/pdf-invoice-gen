/**
 * Group 14 Phase D — template JPEG thumbnails.
 * Port of uae-invoiceing-app/server/services/template-thumbnail.service.ts
 *
 * Generation: renderTemplatePreviewHtmlById → applyA4DocumentLayout → htmlToPreviewPng
 * (viewport 720×1020, JPEG quality 72). Cached on InvoiceTemplate.thumbnailJpeg.
 * Refresh is async via scheduleTemplateThumbnailRefresh and does not block save.
 */

import prisma from "../db.server";
import { applyA4DocumentLayout } from "./document-preview.server";
import { htmlToPreviewPng } from "./pdf-generator.server";

const inflight = new Map<string, Promise<Buffer | null>>();
let active = 0;
const waiters: Array<() => void> = [];
const MAX_CONCURRENT = 2;

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

function cacheFresh(
  generatedAt: Date | null | undefined,
  updatedAt: Date | null | undefined,
): boolean {
  if (!generatedAt) return false;
  if (!updatedAt) return true;
  return generatedAt.getTime() + 1000 >= updatedAt.getTime();
}

async function generateAndStore(
  shopDomain: string,
  templateId: string,
): Promise<Buffer | null> {
  const { renderTemplatePreviewHtmlById } = await import("./template.server");
  const html = await renderTemplatePreviewHtmlById(shopDomain, templateId);
  if (!html) return null;
  const page = applyA4DocumentLayout(html);
  const jpeg = await htmlToPreviewPng(page);
  // timestamps: false parity — avoid bumping updatedAt when only caching thumbnail.
  // Prisma always touches updatedAt on update; use raw SQL for this write.
  await prisma.$executeRaw`
    UPDATE "InvoiceTemplate"
    SET "thumbnailJpeg" = ${jpeg},
        "thumbnailGeneratedAt" = ${new Date()}
    WHERE "id" = ${templateId}
  `;
  return jpeg;
}

/**
 * Return cached JPEG or regenerate. Caller must have already verified store access
 * (old route uses getTemplateByIdForShop before this).
 */
export async function getTemplateThumbnailJpeg(
  shopDomain: string,
  templateId: string,
): Promise<Buffer | null> {
  const existing = inflight.get(templateId);
  if (existing) return existing;

  const work = (async () => {
    const doc = await prisma.invoiceTemplate.findUnique({
      where: { id: templateId },
      select: {
        isActive: true,
        updatedAt: true,
        thumbnailJpeg: true,
        thumbnailGeneratedAt: true,
      },
    });
    if (!doc || doc.isActive === false) return null;

    const cached = doc.thumbnailJpeg
      ? Buffer.from(doc.thumbnailJpeg)
      : null;
    if (cached && cacheFresh(doc.thumbnailGeneratedAt, doc.updatedAt)) {
      return cached;
    }

    return withSlot(() => generateAndStore(shopDomain, templateId));
  })();

  inflight.set(templateId, work);
  try {
    return await work;
  } finally {
    inflight.delete(templateId);
  }
}

/** Fire-and-forget refresh after create/save/save-as (old parity — does not block). */
export function scheduleTemplateThumbnailRefresh(
  shopDomain: string,
  templateId: string,
): void {
  setTimeout(() => {
    getTemplateThumbnailJpeg(shopDomain, templateId).catch((error) => {
      console.error("[templates] thumbnail refresh failed:", error);
    });
  }, 0);
}
