/** Client-safe branding types and UI messages (not server-only). */

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

export const MAX_LOGO_BYTES = 500_000;

export const LOGO_TOO_LARGE_MESSAGE =
  "Logo must be 500 KB or smaller. Compress the image and try again.";

export const LOGO_INVALID_MESSAGE =
  "Logo upload was too large or invalid. Use a PNG/JPG/WebP under 500 KB, or paste a public URL.";

export const INVALID_HEX_MESSAGE =
  "Enter a valid hex color like #1A2B3C for this brand color.";
