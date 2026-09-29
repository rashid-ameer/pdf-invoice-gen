import prisma from "../db.server";

export interface StoreBrandingFormData {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string;
  footerText: string;
}

export interface StoreBrandingInput {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  footerText?: string;
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
const MAX_LOGO_BYTES = 500_000;
const MAX_FOOTER_LENGTH = 500;

export const LOGO_TOO_LARGE_MESSAGE =
  "Logo must be 500 KB or smaller. Compress the image and try again.";

export const LOGO_INVALID_MESSAGE =
  "Logo upload was too large or invalid. Use a PNG/JPG under 500 KB, or paste a public URL.";

export const INVALID_HEX_MESSAGE =
  "Enter a valid hex color like #1A2B3C for this brand color.";

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
): Promise<StoreBrandingFormData> {
  const row = await prisma.shopBranding.upsert({
    where: { shop },
    update: {},
    create: {
      shop,
      ...DEFAULT_BRANDING,
    },
  });
  return toFormData(row);
}

export async function saveBrandingForShop(
  shop: string,
  input: StoreBrandingInput,
  options?: { logoUploadAttempted?: boolean },
): Promise<{ branding: StoreBrandingFormData; error?: string }> {
  const resolved = resolveBranding(input);
  const logoUploadAttempted = options?.logoUploadAttempted === true;
  const logoRejected = logoUploadAttempted && !resolved.logoUrl;

  await prisma.shopBranding.upsert({
    where: { shop },
    create: {
      shop,
      primaryColor: resolved.primaryColor,
      secondaryColor: resolved.secondaryColor,
      accentColor: resolved.accentColor,
      logoUrl: resolved.logoUrl,
      footerText: resolved.footerText,
    },
    update: {
      primaryColor: resolved.primaryColor,
      secondaryColor: resolved.secondaryColor,
      accentColor: resolved.accentColor,
      logoUrl: resolved.logoUrl,
      footerText: resolved.footerText,
    },
  });

  const branding = await getBrandingInputForShop(shop);
  if (logoRejected) {
    return { branding, error: LOGO_INVALID_MESSAGE };
  }
  return { branding };
}
