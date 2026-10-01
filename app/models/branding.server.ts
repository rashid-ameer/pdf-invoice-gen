import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import {
  INVALID_HEX_MESSAGE,
  LOGO_INVALID_MESSAGE,
  LOGO_TOO_LARGE_MESSAGE,
  MAX_LOGO_BYTES,
  type StoreBrandingFormData,
  type StoreBrandingInput,
} from "./branding";
import {
  resolveSocialLinks,
  sanitizeSocialUrl,
  type ResolvedSocialLinks,
  type StoreSocialLinksInput,
} from "./social-links.server";

export type { StoreBrandingFormData, StoreBrandingInput };
export {
  INVALID_HEX_MESSAGE,
  LOGO_INVALID_MESSAGE,
  LOGO_TOO_LARGE_MESSAGE,
  MAX_LOGO_BYTES,
};

/** Resolved branding used by documents / readiness (old StoreBrandingData). */
export interface StoreBrandingData extends StoreBrandingFormData {
  socialLinks: ResolvedSocialLinks;
}

const DEFAULT_BRANDING: StoreBrandingFormData = {
  primaryColor: "#008060",
  secondaryColor: "#6d7175",
  accentColor: "#004c3f",
  logoUrl: "",
  footerText: "Thank you for your business",
};

const INSTALL_DEFAULT_COLORS = {
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
};

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const MAX_FOOTER_LENGTH = 500;
function normalizeHexColor(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return HEX_COLOR.test(trimmed) ? trimmed : fallback;
}

export function sanitizeLogoUrl(value: string | undefined): string {
  const url = value?.trim() ?? "";
  if (!url) return "";

  if (url.startsWith("data:image/")) {
    const match = url.match(/^data:image\/(png|jpe?g|webp|gif);base64,/i);
    if (!match) return "";
    const payload = url.slice(url.indexOf(",") + 1);
    const bytes = Math.ceil((payload.length * 3) / 4);
    if (bytes > MAX_LOGO_BYTES) return "";
    return url.replace(/"/g, "%22");
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url.replace(/"/g, "%22");
    }
  } catch {
    return "";
  }

  return "";
}

/** Matches old isBrandingConfigured (readiness / dashboard). */
export function isBrandingConfigured(
  branding: {
    logoUrl?: string | null;
    footerText?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
  } | null,
): boolean {
  if (!branding) return false;
  const defaultFooter = "Thank you for your business";
  const footer = (branding.footerText || "").trim();
  const customFooter = Boolean(footer && footer !== defaultFooter);
  return Boolean(
    branding.logoUrl ||
      customFooter ||
      (branding.primaryColor && branding.primaryColor !== "#1a1a2e") ||
      (branding.secondaryColor && branding.secondaryColor !== "#16213e") ||
      (branding.accentColor && branding.accentColor !== "#0f3460"),
  );
}

function pickColor(
  value: string | undefined,
  fallback: string,
  installDefault?: string,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || (installDefault && trimmed.toLowerCase() === installDefault.toLowerCase())) {
    return fallback;
  }
  return normalizeHexColor(trimmed, fallback);
}

function displayColor(
  value: string | null | undefined,
  installDefault: string,
  fallback: string,
): string {
  if (!value || value.toLowerCase() === installDefault.toLowerCase()) return fallback;
  return value;
}

function resolveBranding(input: StoreBrandingInput): StoreBrandingFormData {
  return {
    primaryColor: pickColor(
      input.primaryColor,
      DEFAULT_BRANDING.primaryColor,
      INSTALL_DEFAULT_COLORS.primaryColor,
    ),
    secondaryColor: pickColor(
      input.secondaryColor,
      DEFAULT_BRANDING.secondaryColor,
      INSTALL_DEFAULT_COLORS.secondaryColor,
    ),
    accentColor: pickColor(
      input.accentColor,
      DEFAULT_BRANDING.accentColor,
      INSTALL_DEFAULT_COLORS.accentColor,
    ),
    logoUrl: sanitizeLogoUrl(input.logoUrl),
    footerText: (input.footerText?.trim() || DEFAULT_BRANDING.footerText).slice(
      0,
      MAX_FOOTER_LENGTH,
    ),
  };
}

function toFormData(row: {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string;
  footerText: string;
}): StoreBrandingFormData {
  return {
    primaryColor: displayColor(
      row.primaryColor,
      INSTALL_DEFAULT_COLORS.primaryColor,
      DEFAULT_BRANDING.primaryColor,
    ),
    secondaryColor: displayColor(
      row.secondaryColor,
      INSTALL_DEFAULT_COLORS.secondaryColor,
      DEFAULT_BRANDING.secondaryColor,
    ),
    accentColor: displayColor(
      row.accentColor,
      INSTALL_DEFAULT_COLORS.accentColor,
      DEFAULT_BRANDING.accentColor,
    ),
    logoUrl: row.logoUrl ?? "",
    footerText: row.footerText || DEFAULT_BRANDING.footerText,
  };
}

export async function getBrandingInputForShop(
  shop: string,
): Promise<StoreBrandingFormData | null> {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shop, status: "active" },
  });
  if (!store) return null;

  const row = await prisma.shopBranding.findUnique({
    where: { shop },
  });
  if (!row) {
    return {
      primaryColor: DEFAULT_BRANDING.primaryColor,
      secondaryColor: DEFAULT_BRANDING.secondaryColor,
      accentColor: DEFAULT_BRANDING.accentColor,
      logoUrl: "",
      footerText: DEFAULT_BRANDING.footerText,
    };
  }
  return toFormData(row);
}

/**
 * Matches old getBrandingForShop: active store required; missing branding row
 * returns display defaults with empty social links.
 */
export async function getBrandingForShop(
  shopDomain: string,
): Promise<StoreBrandingData | null> {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) return null;

  const doc = await prisma.shopBranding.findUnique({
    where: { shop: shopDomain },
  });
  if (!doc) {
    return {
      ...DEFAULT_BRANDING,
      socialLinks: { visible: false, links: [] },
    };
  }

  const resolved = resolveBranding({
    primaryColor: doc.primaryColor ?? undefined,
    secondaryColor: doc.secondaryColor ?? undefined,
    accentColor: doc.accentColor ?? undefined,
    logoUrl: doc.logoUrl ?? undefined,
    footerText: doc.footerText ?? undefined,
  });

  return {
    ...resolved,
    socialLinks: resolveSocialLinks(readSocialLinksFromDoc(doc.socialLinks)),
  };
}

export async function saveBrandingForShop(
  shop: string,
  input: StoreBrandingInput,
  options?: { logoUploadAttempted?: boolean },
): Promise<{ branding: StoreBrandingFormData; error?: string } | null> {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shop, status: "active" },
  });
  if (!store) return null;

  const resolved = resolveBranding(input);
  const logoUploadAttempted = options?.logoUploadAttempted === true;
  // Old mongoose wrote `logoUrl: resolved.logoUrl || undefined`, so a rejected
  // upload omitted the field and left the prior logo in place.
  const logoRejected = logoUploadAttempted && !resolved.logoUrl;

  await prisma.shopBranding.upsert({
    where: { shop },
    create: {
      shop,
      primaryColor: resolved.primaryColor,
      secondaryColor: resolved.secondaryColor,
      accentColor: resolved.accentColor,
      logoUrl: logoRejected ? "" : resolved.logoUrl,
      footerText: resolved.footerText,
    },
    update: {
      primaryColor: resolved.primaryColor,
      secondaryColor: resolved.secondaryColor,
      accentColor: resolved.accentColor,
      footerText: resolved.footerText,
      ...(logoRejected ? {} : { logoUrl: resolved.logoUrl }),
    },
  });

  const branding = await getBrandingInputForShop(shop);
  if (!branding) return null;
  if (logoRejected) {
    return { branding, error: LOGO_INVALID_MESSAGE };
  }
  return { branding };
}

function readSocialLinksFromDoc(
  socialLinks: Prisma.JsonValue | null | undefined,
): StoreSocialLinksInput {
  if (!socialLinks || typeof socialLinks !== "object" || Array.isArray(socialLinks)) {
    return { showOnInvoice: false };
  }
  const social = socialLinks as Record<string, unknown>;
  const entry = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const row = value as { label?: string | null; url?: string | null };
    return {
      label: row.label ?? undefined,
      url: row.url ?? undefined,
    };
  };
  return {
    showOnInvoice: social.showOnInvoice === true,
    website: entry(social.website),
    instagram: entry(social.instagram),
    x: entry(social.x),
    facebook: entry(social.facebook),
    linkedin: entry(social.linkedin),
    tiktok: entry(social.tiktok),
    youtube: entry(social.youtube),
  };
}

function socialLinksPersistPayload(input: StoreSocialLinksInput) {
  return {
    showOnInvoice: input.showOnInvoice === true,
    website: {
      label: input.website?.label?.trim() || undefined,
      url: sanitizeSocialUrl(input.website?.url) || undefined,
    },
    instagram: {
      label: input.instagram?.label?.trim() || undefined,
      url: sanitizeSocialUrl(input.instagram?.url) || undefined,
    },
    x: {
      label: input.x?.label?.trim() || undefined,
      url: sanitizeSocialUrl(input.x?.url) || undefined,
    },
    facebook: {
      label: input.facebook?.label?.trim() || undefined,
      url: sanitizeSocialUrl(input.facebook?.url) || undefined,
    },
    linkedin: {
      label: input.linkedin?.label?.trim() || undefined,
      url: sanitizeSocialUrl(input.linkedin?.url) || undefined,
    },
    tiktok: {
      label: input.tiktok?.label?.trim() || undefined,
      url: sanitizeSocialUrl(input.tiktok?.url) || undefined,
    },
    youtube: {
      label: input.youtube?.label?.trim() || undefined,
      url: sanitizeSocialUrl(input.youtube?.url) || undefined,
    },
  };
}

/** Matches old getBrandingInputForShop socialLinks read (active store only). */
export async function getSocialLinksForShop(
  shopDomain: string,
): Promise<StoreSocialLinksInput | null> {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) return null;

  const doc = await prisma.shopBranding.findUnique({
    where: { shop: shopDomain },
  });
  if (!doc) return { showOnInvoice: false };
  return readSocialLinksFromDoc(doc.socialLinks);
}

/** Matches old saveSocialLinksForShop. */
export async function saveSocialLinksForShop(
  shopDomain: string,
  input: StoreSocialLinksInput,
): Promise<ResolvedSocialLinks | null> {
  const store = await prisma.store.findFirst({
    where: { shopifyDomain: shopDomain, status: "active" },
  });
  if (!store) return null;

  const resolved = resolveSocialLinks(input);
  const socialLinks = socialLinksPersistPayload(input);

  await prisma.shopBranding.upsert({
    where: { shop: shopDomain },
    create: {
      shop: shopDomain,
      socialLinks,
    },
    update: { socialLinks },
  });

  return resolved;
}
