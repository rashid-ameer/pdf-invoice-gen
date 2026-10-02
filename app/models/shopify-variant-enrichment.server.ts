import { getOfflineAccessTokenForShop } from "./shopify-offline-session.server";

export type VariantEnrichment = {
  productTitle: string;
  variantTitle: string;
  imageUrl?: string;
  barcode?: string;
};

type ShopifyOrderLine = {
  variant_id?: number | null;
  product_id?: number | null;
  title: string;
  variant_title?: string | null;
  sku?: string | null;
};

type GraphqlVariantNode = {
  id?: string;
  barcode?: string | null;
  sku?: string | null;
  title?: string | null;
  image?: { url?: string | null } | null;
  product?: {
    title?: string | null;
    featuredImage?: { url?: string | null } | null;
  } | null;
};

function variantGid(variantId: number): string {
  return `gid://shopify/ProductVariant/${variantId}`;
}

async function shopifyGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T | null> {
  const response = await fetch(
    `https://${shopDomain}/admin/api/2025-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Shopify GraphQL HTTP ${response.status}`);
  }
  const json = (await response.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data ?? null;
}

export async function fetchVariantEnrichmentByIds(
  shopDomain: string,
  variantIds: number[],
): Promise<Map<number, VariantEnrichment>> {
  const unique = [
    ...new Set(variantIds.filter((id) => Number.isFinite(id) && id > 0)),
  ];
  const result = new Map<number, VariantEnrichment>();
  if (unique.length === 0) return result;

  const accessToken = await getOfflineAccessTokenForShop(shopDomain);
  if (!accessToken) return result;

  const query = `#graphql
    query VariantEnrichment($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          barcode
          sku
          title
          image {
            url(transform: { maxWidth: 160, maxHeight: 160 })
          }
          product {
            title
            featuredImage {
              url(transform: { maxWidth: 160, maxHeight: 160 })
            }
          }
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphql<{ nodes?: GraphqlVariantNode[] }>(
      shopDomain,
      accessToken,
      query,
      { ids: unique.map(variantGid) },
    );

    for (const node of data?.nodes ?? []) {
      if (!node?.id) continue;
      const numericId = Number(node.id.split("/").pop());
      if (!Number.isFinite(numericId)) continue;

      const productTitle = node.product?.title?.trim() || "";
      const variantTitle = node.title?.trim() || "";
      const imageUrl =
        node.image?.url?.trim() ||
        node.product?.featuredImage?.url?.trim() ||
        undefined;
      const barcode = node.barcode?.trim() || undefined;

      result.set(numericId, {
        productTitle,
        variantTitle,
        imageUrl,
        barcode,
      });
    }
  } catch (error) {
    console.warn("[shopify] variant enrichment failed:", error);
  }

  return result;
}

export async function enrichLineItemsFromShopifyOrder<
  T extends {
    description: string;
    sku?: string;
    productTitle?: string;
    variantTitle?: string;
    imageUrl?: string;
    barcode?: string;
  },
>(
  shopDomain: string,
  orderLines: ShopifyOrderLine[],
  lineItems: T[],
): Promise<T[]> {
  const variantIds = orderLines
    .map((line) => line.variant_id)
    .filter((id): id is number => typeof id === "number" && id > 0);

  const enrichment = await fetchVariantEnrichmentByIds(shopDomain, variantIds);
  if (enrichment.size === 0) return lineItems;

  return lineItems.map((item, index) => {
    const orderLine = orderLines[index];
    const variantId = orderLine?.variant_id;
    if (!variantId || !enrichment.has(variantId)) {
      return {
        ...item,
        productTitle: item.productTitle || orderLine?.title?.trim(),
        variantTitle:
          item.variantTitle || orderLine?.variant_title?.trim() || undefined,
      };
    }

    const meta = enrichment.get(variantId)!;
    const productTitle =
      meta.productTitle || orderLine?.title?.trim() || item.description;
    const variantTitle =
      meta.variantTitle ||
      orderLine?.variant_title?.trim() ||
      item.variantTitle;
    const description = variantTitle
      ? `${productTitle} — ${variantTitle}`
      : productTitle;

    return {
      ...item,
      description,
      productTitle,
      variantTitle: variantTitle || undefined,
      imageUrl: meta.imageUrl,
      barcode: meta.barcode || item.barcode,
      sku: item.sku || orderLine?.sku || undefined,
    };
  });
}
