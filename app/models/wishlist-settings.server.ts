import prisma from '../db.server';

export type WishlistSettings = {
  enabled: boolean;
  iconStyle: string;
  iconAnimation: string;
  iconColor: string;
  iconColorActive: string;
  iconSize: number;
  bgColor: string;
  bgColorActive: string;
  padding: number;
  borderRadius: number;
  showOnHover: boolean;
};

/** Snake_case payload matching Rails / theme embed. */
export type WishlistSettingsPublic = {
  enabled: boolean;
  icon_style: string;
  icon_animation: string;
  icon_color: string;
  icon_color_active: string;
  icon_size: number;
  bg_color: string;
  bg_color_active: string;
  padding: number;
  border_radius: number;
  show_on_hover: boolean;
};

/** Defaults matching MIG3-create_wishlist_settings. */
export const DEFAULT_WISHLIST_SETTINGS: WishlistSettings = {
  enabled: false,
  iconStyle: 'heart',
  iconAnimation: 'fill',
  iconColor: '#ff4757',
  iconColorActive: '#ffffff',
  iconSize: 20,
  bgColor: '#ffffff',
  bgColorActive: '#ff4757',
  padding: 4,
  borderRadius: 50,
  showOnHover: false,
};

function normalizeShop(shop: string) {
  return shop.toString().trim().toLowerCase();
}

function rowToSettings(row: {
  enabled: boolean;
  iconStyle: string;
  iconAnimation: string;
  iconColor: string;
  iconColorActive: string;
  iconSize: number;
  bgColor: string;
  bgColorActive: string;
  padding: number;
  borderRadius: number;
  showOnHover: boolean;
}): WishlistSettings {
  return {
    enabled: row.enabled,
    iconStyle: row.iconStyle || DEFAULT_WISHLIST_SETTINGS.iconStyle,
    iconAnimation:
      row.iconAnimation || DEFAULT_WISHLIST_SETTINGS.iconAnimation,
    iconColor: row.iconColor || DEFAULT_WISHLIST_SETTINGS.iconColor,
    iconColorActive:
      row.iconColorActive || DEFAULT_WISHLIST_SETTINGS.iconColorActive,
    iconSize: row.iconSize || DEFAULT_WISHLIST_SETTINGS.iconSize,
    bgColor: row.bgColor || DEFAULT_WISHLIST_SETTINGS.bgColor,
    bgColorActive:
      row.bgColorActive || DEFAULT_WISHLIST_SETTINGS.bgColorActive,
    padding: row.padding ?? DEFAULT_WISHLIST_SETTINGS.padding,
    borderRadius: row.borderRadius ?? DEFAULT_WISHLIST_SETTINGS.borderRadius,
    showOnHover: row.showOnHover,
  };
}

export function toPublicSnakeCase(
  settings: WishlistSettings,
): WishlistSettingsPublic {
  return {
    enabled: settings.enabled,
    icon_style: settings.iconStyle,
    icon_animation: settings.iconAnimation,
    icon_color: settings.iconColor,
    icon_color_active: settings.iconColorActive,
    icon_size: settings.iconSize,
    bg_color: settings.bgColor,
    bg_color_active: settings.bgColorActive,
    padding: settings.padding,
    border_radius: settings.borderRadius,
    show_on_hover: settings.showOnHover,
  };
}

export async function getWishlistSettings(
  shop: string,
): Promise<WishlistSettings> {
  const domain = normalizeShop(shop);
  if (!domain) return {...DEFAULT_WISHLIST_SETTINGS};

  const row = await prisma.wishlistSetting.findUnique({
    where: {shop: domain},
  });
  return row ? rowToSettings(row) : {...DEFAULT_WISHLIST_SETTINGS};
}

export async function saveWishlistSettings(
  shop: string,
  input: Partial<WishlistSettings> & Partial<WishlistSettingsPublic>,
): Promise<WishlistSettings> {
  const domain = normalizeShop(shop);
  const current = await getWishlistSettings(domain);

  const next: WishlistSettings = {
    enabled:
      input.enabled !== undefined ? Boolean(input.enabled) : current.enabled,
    iconStyle:
      (input.iconStyle ?? input.icon_style ?? current.iconStyle).trim() ||
      DEFAULT_WISHLIST_SETTINGS.iconStyle,
    iconAnimation:
      (
        input.iconAnimation ??
        input.icon_animation ??
        current.iconAnimation
      ).trim() || DEFAULT_WISHLIST_SETTINGS.iconAnimation,
    iconColor:
      (input.iconColor ?? input.icon_color ?? current.iconColor).trim() ||
      DEFAULT_WISHLIST_SETTINGS.iconColor,
    iconColorActive:
      (
        input.iconColorActive ??
        input.icon_color_active ??
        current.iconColorActive
      ).trim() || DEFAULT_WISHLIST_SETTINGS.iconColorActive,
    iconSize: Number(
      input.iconSize ?? input.icon_size ?? current.iconSize,
    ) || DEFAULT_WISHLIST_SETTINGS.iconSize,
    bgColor:
      (input.bgColor ?? input.bg_color ?? current.bgColor).trim() ||
      DEFAULT_WISHLIST_SETTINGS.bgColor,
    bgColorActive:
      (
        input.bgColorActive ??
        input.bg_color_active ??
        current.bgColorActive
      ).trim() || DEFAULT_WISHLIST_SETTINGS.bgColorActive,
    padding: Number(input.padding ?? current.padding),
    borderRadius: Number(
      input.borderRadius ?? input.border_radius ?? current.borderRadius,
    ),
    showOnHover:
      input.showOnHover !== undefined
        ? Boolean(input.showOnHover)
        : input.show_on_hover !== undefined
          ? Boolean(input.show_on_hover)
          : current.showOnHover,
  };

  const row = await prisma.wishlistSetting.upsert({
    where: {shop: domain},
    create: {shop: domain, ...next},
    update: next,
  });
  return rowToSettings(row);
}
