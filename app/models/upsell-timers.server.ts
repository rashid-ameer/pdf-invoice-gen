import type {UpsellTimer} from '@prisma/client';

import prisma from '../db.server';

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {variables?: Record<string, unknown>},
  ) => Promise<Response>;
};

export type TimerProductInput = {
  product_id?: string;
  variant_id?: string;
  timer_price?: number | string;
};

export type UpsellTimerConfig = {
  enabled?: boolean;
  countdown_date?: string;
  products?: TimerProductInput[];
};

function normalizeShop(shop: string) {
  return shop.toString().trim().toLowerCase();
}

/** Cents stored in DB → Shopify money string (dollars). */
export function centsToMoneyString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Dollar amount → cents. */
export function moneyToCents(value: number | string): number {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

async function graphqlJson<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(
    query,
    variables ? {variables} : undefined,
  );
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{message: string}>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  if (!json.data) {
    throw new Error('Shopify GraphQL returned no data');
  }
  return json.data;
}

export async function listActiveTimers(shop: string) {
  return prisma.upsellTimer.findMany({
    where: {shop: normalizeShop(shop), status: 'active'},
    orderBy: {endsAt: 'asc'},
  });
}

export async function getTimerById(shop: string, id: string) {
  return prisma.upsellTimer.findFirst({
    where: {id, shop: normalizeShop(shop)},
  });
}

export async function createTimer(
  shop: string,
  data: {
    variantGid: string;
    productGid: string;
    productHandle?: string | null;
    originalPrice: number;
    originalCompareAtPrice?: number | null;
    timerPrice: number;
    endsAt: Date;
  },
) {
  return prisma.upsellTimer.create({
    data: {
      shop: normalizeShop(shop),
      variantGid: data.variantGid,
      productGid: data.productGid,
      productHandle: data.productHandle ?? null,
      originalPrice: data.originalPrice,
      originalCompareAtPrice: data.originalCompareAtPrice ?? null,
      timerPrice: data.timerPrice,
      endsAt: data.endsAt,
      status: 'active',
    },
  });
}

export async function updateTimerStatus(
  id: string,
  status: 'active' | 'completed' | 'failed',
) {
  return prisma.upsellTimer.update({
    where: {id},
    data: {status},
  });
}

export async function deleteTimersForShop(shop: string) {
  return prisma.upsellTimer.deleteMany({where: {shop: normalizeShop(shop)}});
}

type VariantPriceInfo = {
  price: string;
  compareAtPrice: string | null;
  productGid: string;
  productHandle?: string | null;
};

export async function fetchVariantPrice(
  admin: AdminGraphqlClient,
  variantGid: string,
): Promise<VariantPriceInfo | null> {
  const data = await graphqlJson<{
    productVariant: {
      id: string;
      price: string;
      compareAtPrice: string | null;
      product: {id: string; handle: string};
    } | null;
  }>(
    admin,
    `#graphql
      query UpsellGetVariantPrice($id: ID!) {
        productVariant(id: $id) {
          id
          price
          compareAtPrice
          product { id handle }
        }
      }
    `,
    {id: variantGid},
  );

  const v = data.productVariant;
  if (!v) return null;
  return {
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    productGid: v.product.id,
    productHandle: v.product.handle,
  };
}

export async function fetchAllProductVariants(
  admin: AdminGraphqlClient,
  productGid: string,
): Promise<
  Array<{
    variantGid: string;
    productGid: string;
    originalPrice: string;
    compareAtPrice: string | null;
  }>
> {
  const data = await graphqlJson<{
    product: {
      id: string;
      variants: {
        edges: Array<{
          node: {
            id: string;
            price: string;
            compareAtPrice: string | null;
          };
        }>;
      };
    } | null;
  }>(
    admin,
    `#graphql
      query UpsellGetProductAllVariants($id: ID!) {
        product(id: $id) {
          id
          variants(first: 100) {
            edges {
              node { id price compareAtPrice }
            }
          }
        }
      }
    `,
    {id: productGid},
  );

  if (!data.product) return [];
  return data.product.variants.edges.map((edge) => ({
    variantGid: edge.node.id,
    productGid: data.product!.id,
    originalPrice: edge.node.price,
    compareAtPrice: edge.node.compareAtPrice,
  }));
}

export async function applyTimerPrice(
  admin: AdminGraphqlClient,
  input: {
    variantGid: string;
    productGid: string;
    price: number | string;
    compareAtPrice?: number | string | null;
  },
) {
  const price =
    typeof input.price === 'number'
      ? input.price.toFixed(2)
      : String(input.price);
  const compareAtPrice =
    input.compareAtPrice == null
      ? null
      : typeof input.compareAtPrice === 'number'
        ? input.compareAtPrice.toFixed(2)
        : String(input.compareAtPrice);

  const data = await graphqlJson<{
    productVariantsBulkUpdate: {
      productVariants: Array<{id: string; price: string}> | null;
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation UpsellUpdateVariantPrice(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price compareAtPrice }
          userErrors { field message }
        }
      }
    `,
    {
      productId: input.productGid,
      variants: [
        {
          id: input.variantGid,
          price,
          compareAtPrice,
        },
      ],
    },
  );

  const errors = data.productVariantsBulkUpdate.userErrors;
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
  return data.productVariantsBulkUpdate;
}

export async function revertTimerPrice(
  admin: AdminGraphqlClient,
  timer: UpsellTimer,
): Promise<void> {
  try {
    await applyTimerPrice(admin, {
      variantGid: timer.variantGid,
      productGid: timer.productGid,
      price: centsToMoneyString(timer.originalPrice),
      compareAtPrice: null,
    });
    await updateTimerStatus(timer.id, 'completed');
  } catch (error) {
    await updateTimerStatus(timer.id, 'failed');
    throw error;
  }
}

async function processTimerVariant(
  admin: AdminGraphqlClient,
  shop: string,
  input: {
    variantGid: string;
    productGid: string;
    originalPrice: string;
    originalCompareAtPrice?: string | null;
    timerPriceDollars: number;
    endsAt: Date;
    productHandle?: string | null;
  },
): Promise<UpsellTimer | null> {
  const timerPriceCents = moneyToCents(input.timerPriceDollars);
  if (timerPriceCents <= 0) return null;

  await applyTimerPrice(admin, {
    variantGid: input.variantGid,
    productGid: input.productGid,
    price: input.timerPriceDollars,
    compareAtPrice: parseFloat(input.originalPrice),
  });

  return createTimer(shop, {
    variantGid: input.variantGid,
    productGid: input.productGid,
    productHandle: input.productHandle,
    originalPrice: moneyToCents(input.originalPrice),
    originalCompareAtPrice: input.originalCompareAtPrice
      ? moneyToCents(input.originalCompareAtPrice)
      : null,
    timerPrice: timerPriceCents,
    endsAt: input.endsAt,
  });
}

/**
 * Revert existing active timers, then create new ones from timer config
 * when countdown is enabled with products + future end date.
 */
export async function handleTimerChanges(
  admin: AdminGraphqlClient,
  shop: string,
  timerConfig: UpsellTimerConfig | null | undefined,
): Promise<{created: string[]}> {
  const domain = normalizeShop(shop);
  const existing = await listActiveTimers(domain);
  for (const timer of existing) {
    try {
      await revertTimerPrice(admin, timer);
    } catch (error) {
      console.error(
        `[UpsellTimer] Revert failed for ${timer.variantGid}:`,
        error,
      );
    }
  }

  if (!timerConfig?.enabled) return {created: []};
  const products = Array.isArray(timerConfig.products)
    ? timerConfig.products
    : [];
  if (!products.length || !timerConfig.countdown_date) {
    return {created: []};
  }

  const endsAt = new Date(timerConfig.countdown_date);
  if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) {
    console.warn('[UpsellTimer] Timer end time is in the past, skipping');
    return {created: []};
  }

  const created: string[] = [];

  for (const product of products) {
    let variantGid = String(product.variant_id || '').trim();
    const timerPrice = Number(product.timer_price);
    if (!variantGid) continue;

    if (variantGid.includes('ProductVariant/')) {
      const test = await fetchVariantPrice(admin, variantGid);
      if (!test) {
        const productGid = variantGid.replace('ProductVariant', 'Product');
        const allVariants = await fetchAllProductVariants(admin, productGid);
        for (const v of allVariants) {
          const row = await processTimerVariant(admin, domain, {
            variantGid: v.variantGid,
            productGid: v.productGid,
            originalPrice: v.originalPrice,
            originalCompareAtPrice: v.compareAtPrice,
            timerPriceDollars: timerPrice,
            endsAt,
          });
          if (row) created.push(row.id);
        }
        continue;
      }

      const row = await processTimerVariant(admin, domain, {
        variantGid,
        productGid: test.productGid,
        originalPrice: test.price,
        originalCompareAtPrice: test.compareAtPrice,
        timerPriceDollars: timerPrice,
        endsAt,
        productHandle: test.productHandle,
      });
      if (row) created.push(row.id);
      continue;
    }

    // Treat as product GID — update all variants
    if (variantGid.includes('Product/')) {
      const allVariants = await fetchAllProductVariants(admin, variantGid);
      for (const v of allVariants) {
        const row = await processTimerVariant(admin, domain, {
          variantGid: v.variantGid,
          productGid: v.productGid,
          originalPrice: v.originalPrice,
          originalCompareAtPrice: v.compareAtPrice,
          timerPriceDollars: timerPrice,
          endsAt,
        });
        if (row) created.push(row.id);
      }
      continue;
    }

    // Numeric ID fallback
    if (/^\d+$/.test(variantGid)) {
      variantGid = `gid://shopify/ProductVariant/${variantGid}`;
      const original = await fetchVariantPrice(admin, variantGid);
      if (!original) continue;
      const row = await processTimerVariant(admin, domain, {
        variantGid,
        productGid:
          String(product.product_id || '').trim() || original.productGid,
        originalPrice: original.price,
        originalCompareAtPrice: original.compareAtPrice,
        timerPriceDollars: timerPrice,
        endsAt,
        productHandle: original.productHandle,
      });
      if (row) created.push(row.id);
    }
  }

  return {created};
}

/**
 * Revert all active timers whose endsAt is in the past.
 * `getAdmin` should return an authenticated Admin API client for the shop
 * (e.g. via unauthenticated.admin(shop)).
 */
export async function revertDueTimers(
  getAdmin: (shop: string) => Promise<AdminGraphqlClient>,
): Promise<{scanned: number; reverted: number; failed: number; shops: number}> {
  const due = await prisma.upsellTimer.findMany({
    where: {
      status: 'active',
      endsAt: {lt: new Date()},
    },
    orderBy: {shop: 'asc'},
  });

  const byShop = new Map<string, UpsellTimer[]>();
  for (const timer of due) {
    const list = byShop.get(timer.shop) || [];
    list.push(timer);
    byShop.set(timer.shop, list);
  }

  let reverted = 0;
  let failed = 0;

  for (const [shop, timers] of byShop) {
    let admin: AdminGraphqlClient;
    try {
      admin = await getAdmin(shop);
    } catch (error) {
      console.error(`[UpsellTimer] No admin session for ${shop}:`, error);
      failed += timers.length;
      continue;
    }

    for (const timer of timers) {
      try {
        await revertTimerPrice(admin, timer);
        reverted += 1;
      } catch (error) {
        console.error(
          `[UpsellTimer] Revert failed ${timer.id} ${timer.variantGid}:`,
          error,
        );
        failed += 1;
      }
    }
  }

  return {
    scanned: due.length,
    reverted,
    failed,
    shops: byShop.size,
  };
}
