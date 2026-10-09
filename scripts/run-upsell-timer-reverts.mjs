/**
 * Revert expired upsell countdown timer prices.
 *
 * Usage (from project root):
 *   npm run upsell-timers:run
 *
 * Modes:
 * 1) HTTP (preferred when app is running):
 *    Requires SHOPIFY_APP_URL + CRON_SECRET
 *    Calls /api/cron/upsell-timer-reverts with Bearer auth
 *
 * 2) Direct (local DB + Admin API with offline session tokens):
 *    Requires DATABASE_URL; uses Session.accessToken per shop
 */
import {readFileSync} from 'fs';
import {dirname, resolve} from 'path';
import {fileURLToPath} from 'url';
import {PrismaClient} from '@prisma/client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prisma = new PrismaClient();
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

function loadEnvFile() {
  try {
    const content = readFileSync(resolve(root, '.env'), 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    console.warn('Could not read .env');
  }
}

function centsToMoney(cents) {
  return (Number(cents) / 100).toFixed(2);
}

async function adminGraphql(shop, accessToken, query, variables) {
  const response = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({query, variables}),
    },
  );
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
}

async function revertTimer(shop, accessToken, timer) {
  const data = await adminGraphql(
    shop,
    accessToken,
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }`,
    {
      productId: timer.productGid,
      variants: [
        {
          id: timer.variantGid,
          price: centsToMoney(timer.originalPrice),
          compareAtPrice: null,
        },
      ],
    },
  );
  const errors = data?.productVariantsBulkUpdate?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
}

async function runHttpMode() {
  const base = String(
    process.env.SHOPIFY_APP_URL || process.env.APP_URL || '',
  ).replace(/\/$/, '');
  const secret = process.env.CRON_SECRET?.trim();
  if (!base) return null;
  if (!secret) {
    throw new Error('CRON_SECRET is required for HTTP mode');
  }

  const url = `${base}/api/cron/upsell-timer-reverts`;
  console.log('HTTP mode →', url);
  const response = await fetch(url, {
    headers: {Authorization: `Bearer ${secret}`},
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = {raw: text};
  }
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${typeof body === 'object' ? JSON.stringify(body) : text}`,
    );
  }
  return body;
}

async function runDirectMode() {
  console.log('Direct mode (Prisma + Admin GraphQL)');
  const due = await prisma.upsellTimer.findMany({
    where: {status: 'active', endsAt: {lt: new Date()}},
    orderBy: {shop: 'asc'},
  });
  console.log(`Due timers: ${due.length}`);

  const byShop = new Map();
  for (const timer of due) {
    const list = byShop.get(timer.shop) || [];
    list.push(timer);
    byShop.set(timer.shop, list);
  }

  let reverted = 0;
  let failed = 0;

  for (const [shop, timers] of byShop) {
    const session = await prisma.session.findFirst({
      where: {shop, isOnline: false},
      orderBy: {id: 'desc'},
    });
    if (!session?.accessToken) {
      console.error(`  ${shop}: no offline session`);
      failed += timers.length;
      continue;
    }

    for (const timer of timers) {
      try {
        await revertTimer(shop, session.accessToken, timer);
        await prisma.upsellTimer.update({
          where: {id: timer.id},
          data: {status: 'completed'},
        });
        console.log(`  ✓ ${timer.variantGid}`);
        reverted += 1;
      } catch (error) {
        await prisma.upsellTimer.update({
          where: {id: timer.id},
          data: {status: 'failed'},
        });
        console.error(
          `  ✗ ${timer.variantGid}:`,
          error instanceof Error ? error.message : error,
        );
        failed += 1;
      }
    }
  }

  return {scanned: due.length, reverted, failed, shops: byShop.size};
}

async function main() {
  loadEnvFile();
  console.log('=== Upsell timer reverts ===');

  const preferHttp = Boolean(
    process.env.SHOPIFY_APP_URL || process.env.APP_URL,
  );

  let result;
  if (preferHttp) {
    result = await runHttpMode();
  } else {
    if (
      process.env.NODE_ENV === 'production' &&
      !process.env.CRON_SECRET?.trim()
    ) {
      throw new Error('CRON_SECRET is required in production');
    }
    result = await runDirectMode();
  }

  console.log('=== DONE ===');
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
