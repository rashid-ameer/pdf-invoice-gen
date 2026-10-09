import {unauthenticated} from '../shopify.server';

export type UpsellStorefrontProduct = {
  id: string;
  title: string;
  url: string;
  price: number;
  compare_at_price: number | null;
  available: boolean;
  featured_image: string | null;
  variants: Array<{id: string; price?: string}>;
};

function toGid(id: string) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  if (raw.startsWith('gid://')) return raw;
  return `gid://shopify/Product/${raw}`;
}

function moneyToCents(value: string | number | null | undefined) {
  if (value == null || value === '') return 0;
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  // Admin GraphQL returns decimal currency strings (e.g. "29.00").
  return Math.round(n * 100);
}

function normalizeProductNode(node: {
  id?: string;
  title?: string;
  handle?: string;
  featuredImage?: {url?: string} | null;
  onlineStoreUrl?: string | null;
  variants?: {
    nodes?: Array<{
      id?: string;
      price?: string;
      compareAtPrice?: string | null;
      availableForSale?: boolean;
    }>;
  };
}): UpsellStorefrontProduct | null {
  if (!node?.id || !node.title) return null;
  const numericId = String(node.id).split('/').pop() || '';
  const variants = (node.variants?.nodes || [])
    .filter((v) => v?.id)
    .map((v) => ({
      id: String(v.id).split('/').pop() || String(v.id),
      price: v.price,
    }));
  const first = node.variants?.nodes?.[0];
  return {
    id: numericId,
    title: node.title,
    url: node.onlineStoreUrl || `/products/${node.handle || ''}`,
    price: moneyToCents(first?.price),
    compare_at_price: first?.compareAtPrice
      ? moneyToCents(first.compareAtPrice)
      : null,
    available: first?.availableForSale !== false,
    featured_image: node.featuredImage?.url || null,
    variants,
  };
}

/**
 * Resolve product cards for storefront upsell (bundle / specific offer).
 * Uses offline Admin API — predictive search on the storefront is unreliable for id: queries.
 */
export async function getUpsellProductsByIds(
  shop: string,
  ids: string[],
): Promise<UpsellStorefrontProduct[]> {
  const gids = [...new Set(ids.map(toGid).filter(Boolean))].slice(0, 20);
  if (!gids.length) return [];

  const {admin} = await unauthenticated.admin(shop);
  const response = await admin.graphql(
    `#graphql
      query UpsellProductsByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            onlineStoreUrl
            featuredImage { url }
            variants(first: 25) {
              nodes {
                id
                price
                compareAtPrice
                availableForSale
              }
            }
          }
        }
      }
    `,
    {variables: {ids: gids}},
  );

  const json = (await response.json()) as {
    data?: {nodes?: Array<Record<string, unknown> | null>};
    errors?: Array<{message: string}>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }

  const out: UpsellStorefrontProduct[] = [];
  for (const node of json.data?.nodes || []) {
    if (!node) continue;
    const mapped = normalizeProductNode(
      node as Parameters<typeof normalizeProductNode>[0],
    );
    if (mapped) out.push(mapped);
  }
  return out;
}
