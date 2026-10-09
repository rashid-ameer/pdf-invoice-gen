import type { LoaderFunctionArgs } from "react-router";

import {
  getStorefrontShop,
  storefrontJsonCached,
} from "../models/storefront-api.server";
import { getUpsellProductsByIds } from "../models/upsell-products.server";

/**
 * Resolve upsell/bundle products by ID for the theme widget.
 * App proxy: /apps/pdf-invoice/upsell-products?ids=123,456
 * Also accepts ?shopify_domain= / ?shop= (absolute app URL fallback).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return storefrontJsonCached({ products: [] }, "public, max-age=60");
  }

  try {
    const shop = await getStorefrontShop(request);
    const url = new URL(request.url);
    const ids = String(url.searchParams.get("ids") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const products = await getUpsellProductsByIds(shop, ids);
    return storefrontJsonCached(
      { products },
      "public, max-age=60, stale-while-revalidate=300",
    );
  } catch {
    return storefrontJsonCached(
      { products: [] },
      "public, max-age=30, stale-while-revalidate=60",
    );
  }
};
