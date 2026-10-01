import { htmlToPdfBuffer, pdfFilename } from "./pdf-generator.server";
import {
  getMemoryCachedBuffer,
  hashContent,
  setMemoryCachedBuffer,
} from "./pdf-memory-cache.server";

const PDF_MEMORY_TTL_SECONDS = 30 * 60;

export { pdfFilename };

/**
 * Memory-only PDF cache (Group 7).
 * Key = sha256(html). Identical HTML → hit; changed HTML → miss.
 * Redis/external cache can wrap this later without changing render callers.
 */
export async function cachedHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const digest = hashContent(html);
  const memoryKey = `pdf:${digest}`;

  const memoryHit = getMemoryCachedBuffer(memoryKey);
  if (memoryHit) return memoryHit;

  const pdf = await htmlToPdfBuffer(html);
  setMemoryCachedBuffer(memoryKey, pdf, PDF_MEMORY_TTL_SECONDS);
  return pdf;
}

export function pdfCacheKeyForHtml(html: string): string {
  return `pdf:${hashContent(html)}`;
}
