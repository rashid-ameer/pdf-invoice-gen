import prisma from '../db.server';
import {uploadShopifyImageFile} from './shopify-file-upload.server';

const ALLOWED_ICON_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
  'image/gif',
]);

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_BORDER_RADIUS = 4;

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {variables?: Record<string, unknown>},
  ) => Promise<Response>;
};

export type TrustedBadgeSnake = {
  id: string;
  icon_type: string;
  icon_value: string;
  label_text: string;
  badge_color: string;
  text_color: string;
  font_size: number;
  border_radius: number;
  position: number;
  published: boolean;
};

export type TrustedBadgeInput = {
  icon_type?: string;
  icon_value?: string;
  label_text?: string;
  badge_color?: string;
  text_color?: string;
  font_size?: number;
  border_radius?: number;
  position?: number;
  published?: boolean;
};

function normalizeShop(shop: string) {
  return shop.toString().trim().toLowerCase();
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function serializeBadge(row: {
  id: string;
  iconType: string;
  iconValue: string;
  labelText: string;
  badgeColor: string;
  textColor: string;
  fontSize: number;
  borderRadius: number;
  position: number;
  published: boolean;
}): TrustedBadgeSnake {
  return {
    id: row.id,
    icon_type: row.iconType,
    icon_value: row.iconValue,
    label_text: row.labelText,
    badge_color: row.badgeColor,
    text_color: row.textColor,
    font_size: row.fontSize,
    border_radius: row.borderRadius,
    position: row.position,
    published: row.published,
  };
}

function parseInput(input: TrustedBadgeInput) {
  const iconType = (input.icon_type ?? 'preset').trim() || 'preset';
  if (iconType !== 'preset' && iconType !== 'upload') {
    throw new Error('icon_type must be preset or upload');
  }

  const labelText = (input.label_text ?? '').trim();
  if (!labelText) {
    throw new Error('label_text is required');
  }

  let iconValue = (input.icon_value ?? '').trim();
  if (iconType === 'preset') {
    iconValue = iconValue || 'shield';
  } else if (!iconValue) {
    throw new Error('Custom icon upload is required');
  }
  if (iconValue.startsWith('blob:')) {
    throw new Error('Custom icon upload is required');
  }

  const position =
    typeof input.position === 'number' && Number.isFinite(input.position)
      ? Math.max(0, Math.floor(input.position))
      : 0;

  return {
    iconType,
    iconValue,
    labelText,
    badgeColor: (input.badge_color ?? '#000000').trim() || '#000000',
    textColor: (input.text_color ?? '#ffffff').trim() || '#ffffff',
    fontSize: clampInt(input.font_size, DEFAULT_FONT_SIZE, 10, 32),
    borderRadius: clampInt(
      input.border_radius,
      DEFAULT_BORDER_RADIUS,
      0,
      40,
    ),
    position,
    published: input.published !== false,
  };
}

export async function listBadges(shop: string): Promise<TrustedBadgeSnake[]> {
  const domain = normalizeShop(shop);
  const rows = await prisma.trustedBadge.findMany({
    where: {shop: domain},
    orderBy: [{position: 'asc'}, {createdAt: 'asc'}],
  });
  return rows.map(serializeBadge);
}

export async function listPublishedBadges(
  shop: string,
): Promise<TrustedBadgeSnake[]> {
  const domain = normalizeShop(shop);
  const rows = await prisma.trustedBadge.findMany({
    where: {shop: domain, published: true},
    orderBy: [{position: 'asc'}, {createdAt: 'asc'}],
  });
  return rows.map(serializeBadge);
}

export async function createBadge(
  shop: string,
  input: TrustedBadgeInput,
): Promise<TrustedBadgeSnake> {
  const domain = normalizeShop(shop);
  const data = parseInput(input);

  let position = data.position;
  if (position === 0) {
    const count = await prisma.trustedBadge.count({where: {shop: domain}});
    position = count;
  }

  const row = await prisma.trustedBadge.create({
    data: {
      shop: domain,
      iconType: data.iconType,
      iconValue: data.iconValue,
      labelText: data.labelText,
      badgeColor: data.badgeColor,
      textColor: data.textColor,
      fontSize: data.fontSize,
      borderRadius: data.borderRadius,
      position,
      published: data.published,
    },
  });
  return serializeBadge(row);
}

export async function updateBadge(
  shop: string,
  id: string,
  input: TrustedBadgeInput,
): Promise<TrustedBadgeSnake> {
  const domain = normalizeShop(shop);
  const existing = await prisma.trustedBadge.findFirst({
    where: {id, shop: domain},
  });
  if (!existing) {
    throw new Response('Badge not found', {status: 404});
  }

  const merged: TrustedBadgeInput = {
    icon_type: input.icon_type ?? existing.iconType,
    icon_value: input.icon_value ?? existing.iconValue,
    label_text: input.label_text ?? existing.labelText,
    badge_color: input.badge_color ?? existing.badgeColor,
    text_color: input.text_color ?? existing.textColor,
    font_size:
      input.font_size !== undefined ? input.font_size : existing.fontSize,
    border_radius:
      input.border_radius !== undefined
        ? input.border_radius
        : existing.borderRadius,
    position:
      input.position !== undefined ? input.position : existing.position,
    published:
      input.published !== undefined ? input.published : existing.published,
  };
  const data = parseInput(merged);

  const row = await prisma.trustedBadge.update({
    where: {id: existing.id},
    data: {
      iconType: data.iconType,
      iconValue: data.iconValue,
      labelText: data.labelText,
      badgeColor: data.badgeColor,
      textColor: data.textColor,
      fontSize: data.fontSize,
      borderRadius: data.borderRadius,
      position: data.position,
      published: data.published,
    },
  });
  return serializeBadge(row);
}

export async function deleteBadge(shop: string, id: string): Promise<void> {
  const domain = normalizeShop(shop);
  const existing = await prisma.trustedBadge.findFirst({
    where: {id, shop: domain},
    select: {id: true},
  });
  if (!existing) {
    throw new Response('Badge not found', {status: 404});
  }
  await prisma.trustedBadge.delete({where: {id: existing.id}});
}

export async function bulkReorder(
  shop: string,
  orderedIds: string[],
): Promise<void> {
  const domain = normalizeShop(shop);
  if (!Array.isArray(orderedIds)) {
    throw new Error('ordered_ids must be an array');
  }

  await prisma.$transaction(
    orderedIds.map((badgeId, index) =>
      prisma.trustedBadge.updateMany({
        where: {id: String(badgeId), shop: domain},
        data: {position: index},
      }),
    ),
  );
}

/**
 * Upload a custom badge icon to Shopify Files (write_files).
 * Uses stagedUploadsCreate → POST to staged URL → fileCreate.
 */
export async function uploadBadgeIcon(
  admin: AdminGraphqlClient,
  file: File,
): Promise<{icon_url: string}> {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('Icon file is required');
  }

  const mime = (file.type || '').toLowerCase();
  if (mime && !ALLOWED_ICON_TYPES.has(mime)) {
    throw new Error('Invalid file type');
  }
  if (file.size > MAX_ICON_BYTES) {
    throw new Error('File size must be less than 2MB');
  }

  const iconUrl = await uploadShopifyImageFile(admin, file, 'Trusted badge icon');
  return {icon_url: iconUrl};
}
