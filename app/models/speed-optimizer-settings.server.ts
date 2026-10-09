import prisma from '../db.server';

export type SpeedOptimizerSettings = {
  enabled: boolean;
  excludedPages: string;
  prefetchLimit: number;
};

/** Snake_case payload matching Rails / theme embed. */
export type SpeedOptimizerSettingsPublic = {
  enabled: boolean;
  excluded_pages: string;
  prefetch_limit: number;
};

/** Defaults matching MIG4-create_speed_optimizer_settings. */
export const DEFAULT_SPEED_OPTIMIZER_SETTINGS: SpeedOptimizerSettings = {
  enabled: false,
  excludedPages: '/cart,/account,/checkout',
  prefetchLimit: 10,
};

function normalizeShop(shop: string) {
  return shop.toString().trim().toLowerCase();
}

function rowToSettings(row: {
  enabled: boolean;
  excludedPages: string;
  prefetchLimit: number;
}): SpeedOptimizerSettings {
  return {
    enabled: row.enabled,
    excludedPages:
      row.excludedPages || DEFAULT_SPEED_OPTIMIZER_SETTINGS.excludedPages,
    prefetchLimit:
      row.prefetchLimit || DEFAULT_SPEED_OPTIMIZER_SETTINGS.prefetchLimit,
  };
}

export function toPublicSnakeCase(
  settings: SpeedOptimizerSettings,
): SpeedOptimizerSettingsPublic {
  return {
    enabled: settings.enabled,
    excluded_pages: settings.excludedPages,
    prefetch_limit: settings.prefetchLimit,
  };
}

export async function getSpeedOptimizerSettings(
  shop: string,
): Promise<SpeedOptimizerSettings> {
  const domain = normalizeShop(shop);
  if (!domain) return {...DEFAULT_SPEED_OPTIMIZER_SETTINGS};

  const row = await prisma.speedOptimizerSetting.findUnique({
    where: {shop: domain},
  });
  return row ? rowToSettings(row) : {...DEFAULT_SPEED_OPTIMIZER_SETTINGS};
}

export async function saveSpeedOptimizerSettings(
  shop: string,
  input: Partial<SpeedOptimizerSettings> &
    Partial<SpeedOptimizerSettingsPublic>,
): Promise<SpeedOptimizerSettings> {
  const domain = normalizeShop(shop);
  const current = await getSpeedOptimizerSettings(domain);

  const next: SpeedOptimizerSettings = {
    enabled:
      input.enabled !== undefined ? Boolean(input.enabled) : current.enabled,
    excludedPages: (
      input.excludedPages ??
      input.excluded_pages ??
      current.excludedPages
    ).trim() || DEFAULT_SPEED_OPTIMIZER_SETTINGS.excludedPages,
    prefetchLimit:
      Number(
        input.prefetchLimit ?? input.prefetch_limit ?? current.prefetchLimit,
      ) || DEFAULT_SPEED_OPTIMIZER_SETTINGS.prefetchLimit,
  };

  const row = await prisma.speedOptimizerSetting.upsert({
    where: {shop: domain},
    create: {shop: domain, ...next},
    update: next,
  });
  return rowToSettings(row);
}
