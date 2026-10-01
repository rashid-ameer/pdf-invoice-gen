const ALLOWED_HOSTS = [
  "cdn.shopify.com",
  "cdn.shopifycdn.net",
  "shopifycdn.com",
  "shopify.com",
];

const imageCache = new Map<string, Promise<string | null>>();
const FETCH_TIMEOUT_MS = 6_000;
const MAX_BYTES = 400_000;

function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

function mimeFromResponse(contentType: string, url: string): string | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (
    type === "image/jpeg" ||
    type === "image/jpg" ||
    type === "image/png" ||
    type === "image/webp" ||
    type === "image/gif"
  ) {
    return type === "image/jpg" ? "image/jpeg" : type;
  }
  if (/\.jpe?g(\?|$)/i.test(url)) return "image/jpeg";
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.webp(\?|$)/i.test(url)) return "image/webp";
  if (/\.gif(\?|$)/i.test(url)) return "image/gif";
  return null;
}

export function sanitizeProductImageUrl(url?: string | null): string {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(trimmed)) {
    return trimmed;
  }
  if (/^https:\/\//i.test(trimmed) && isAllowedImageUrl(trimmed)) return trimmed;
  return "";
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!response.ok) return null;
    const mime = mimeFromResponse(response.headers.get("content-type") || "", url);
    if (!mime) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_BYTES) return null;
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Inline remote product images so PDFs don't depend on CDN load during Chromium render. */
export async function inlineProductImageUrl(
  url?: string | null,
): Promise<string | undefined> {
  const source = sanitizeProductImageUrl(url);
  if (!source) return undefined;
  if (source.startsWith("data:")) return source;

  let pending = imageCache.get(source);
  if (!pending) {
    pending = fetchImageAsDataUrl(source);
    imageCache.set(source, pending);
  }
  return (await pending) ?? undefined;
}
