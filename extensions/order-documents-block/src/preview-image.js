/**
 * Load invoice preview bytes for Admin UI `s-image`.
 * Avoids FileReader (unreliable in extension sandbox); builds a data URL.
 */

/**
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * @param {Response} res
 * @returns {Promise<string>}
 */
export async function responseToImageDataUrl(res) {
  const mime =
    (res.headers.get("Content-Type") || "image/jpeg").split(";")[0].trim() ||
    "image/jpeg";
  const buffer = await res.arrayBuffer();
  if (!buffer.byteLength) {
    throw new Error("Empty preview image");
  }
  return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
}

/**
 * @param {string} orderId
 * @param {(url: string, options?: RequestInit, ms?: number) => Promise<Response>} fetchFn
 * @param {Record<string, string>} headers
 * @param {(orderId: string, token?: string) => string} pathFn
 * @returns {Promise<string>}
 */
export async function loadInvoicePreviewDataUrl(
  orderId,
  fetchFn,
  headers,
  pathFn,
) {
  let token = "";
  try {
    if (shopify.auth?.idToken) {
      token = (await shopify.auth.idToken()) || "";
    }
  } catch (err) {
    console.error("preview token failed", err);
  }

  const url = pathFn(orderId, token || undefined);
  const res = await fetchFn(url, { headers }, 45000);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `Preview failed (${res.status})`);
  }
  return responseToImageDataUrl(res);
}
