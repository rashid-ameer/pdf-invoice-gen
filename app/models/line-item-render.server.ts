import type { TemplateConfig } from "./template-config.types";
import {
  barcodeSourceForLine,
  generateBarcodeDataUrl,
} from "./barcode-image.server";
import {
  inlineProductImageUrl,
  sanitizeProductImageUrl,
} from "./line-item-image.server";

export interface RenderLineItemInput {
  description: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  vatRate: string;
  vatAmount: string;
  lineTotal: string;
  sku?: string;
  productTitle?: string;
  variantTitle?: string;
  imageUrl?: string;
  barcode?: string;
}

export interface PreparedLineItem extends RenderLineItemInput {
  barcodeDataUrl?: string;
  descriptionHtml?: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeImageUrl(url?: string | null): string {
  return sanitizeProductImageUrl(url);
}

/** Shopify fills this when a product has no real options (size/color). Hide it. */
export function meaningfulVariantTitle(value?: string | null): string {
  const variant = String(value || "").trim();
  if (!variant) return "";
  if (/^default\s*title$/i.test(variant)) return "";
  return variant;
}

function displayProductTitle(item: PreparedLineItem): string {
  const raw = (item.productTitle || item.description || "").trim();
  return raw.replace(/\s+[—-]\s+Default Title$/i, "").trim() || raw;
}

export function usesRichLineProductCell(config: TemplateConfig): boolean {
  const cols = config.sections.lineItems.columns;
  return (
    cols.productTitle !== false ||
    cols.productImage === true ||
    cols.barcode === true
  );
}

export function buildRichProductDescriptionHtml(
  item: PreparedLineItem,
  config: TemplateConfig,
): string {
  const cols = config.sections.lineItems.columns;
  const showTitle = cols.productTitle !== false;
  const showImage = cols.productImage === true;
  const imageUrl = sanitizeImageUrl(item.imageUrl);
  const title = esc(displayProductTitle(item));
  const variant = meaningfulVariantTitle(item.variantTitle);

  const thumb =
    showImage && imageUrl
      ? `<div class="line-product-thumb-wrap"><img class="line-product-thumb" src="${esc(imageUrl)}" alt="" /></div>`
      : "";

  const barcodeBlock =
    cols.barcode === true && item.barcodeDataUrl
      ? `<div class="line-barcode"><img class="line-barcode-img" src="${item.barcodeDataUrl}" alt="" /></div>`
      : "";

  return `<div class="line-product-row">
    ${thumb}
    <div class="line-product-meta">
      ${showTitle ? `<div class="line-product-title">${title}</div>` : ""}
      ${variant ? `<span class="line-product-variant">${esc(variant)}</span>` : ""}
      ${barcodeBlock}
    </div>
  </div>`;
}

export async function prepareLineItemsForRender(
  items: RenderLineItemInput[],
  config: TemplateConfig,
): Promise<PreparedLineItem[]> {
  const rich = usesRichLineProductCell(config);
  const showBarcode = config.sections.lineItems.columns.barcode === true;
  const showImage = config.sections.lineItems.columns.productImage === true;

  const [barcodeDataUrls, inlinedImages] = await Promise.all([
    showBarcode
      ? Promise.all(
          items.map(async (item) => {
            const source = barcodeSourceForLine(item);
            if (!source) return undefined;
            return (await generateBarcodeDataUrl(source)) ?? undefined;
          }),
        )
      : Promise.resolve([] as Array<string | undefined>),
    showImage
      ? Promise.all(items.map((item) => inlineProductImageUrl(item.imageUrl)))
      : Promise.resolve([] as Array<string | undefined>),
  ]);

  return items.map((item, index) => {
    const next: PreparedLineItem = { ...item };
    if (showBarcode) {
      const source = barcodeSourceForLine(item);
      if (source) {
        next.barcode = source;
        next.barcodeDataUrl = barcodeDataUrls[index];
      }
    }
    if (showImage) {
      next.imageUrl = inlinedImages[index];
    }
    if (rich) {
      next.descriptionHtml = buildRichProductDescriptionHtml(next, config);
    }
    return next;
  });
}
