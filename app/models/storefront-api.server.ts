import { authenticate } from "../shopify.server";

/** Resolve shop from app proxy session, or public query params. */
export async function getStorefrontShop(request: Request) {
  const url = new URL(request.url);
  const fromQuery =
    url.searchParams.get("shopify_domain") ||
    url.searchParams.get("domain") ||
    url.searchParams.get("shop") ||
    "";

  try {
    const { session } = await authenticate.public.appProxy(request);
    const shop = session?.shop || fromQuery;
    if (!shop) {
      throw new Response("Missing shop", { status: 400 });
    }
    return shop;
  } catch (error) {
    // Published storefront data is public; allow shopify_domain/shop without
    // proxy HMAC so badges still load if the app proxy isn't registered yet.
    if (fromQuery.trim()) {
      return fromQuery.trim().toLowerCase();
    }
    throw error instanceof Response
      ? error
      : new Response("Missing shop", { status: 400 });
  }
}

function withStorefrontHeaders(init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("Access-Control-Allow-Origin")) {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  if (!headers.has("Access-Control-Allow-Methods")) {
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  return { ...init, headers };
}

export function storefrontJson(data: unknown, init?: ResponseInit) {
  return Response.json(data, withStorefrontHeaders(init));
}

export function storefrontJsonCached(
  data: unknown,
  cacheControl: string,
  init?: ResponseInit,
) {
  const headers = new Headers(withStorefrontHeaders(init).headers);
  headers.set("Cache-Control", cacheControl);
  return Response.json(data, { ...init, headers });
}
