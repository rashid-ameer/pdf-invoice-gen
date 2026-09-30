export {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  socialLinksFormFieldNames,
  type SocialPlatform,
  type SocialLinkInput,
  type StoreSocialLinksInput,
  type ResolvedSocialLink,
  type ResolvedSocialLinks,
} from "./social-links";

import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  capitalizeSocialPlatform,
  type SocialPlatform,
  type SocialLinkInput,
  type StoreSocialLinksInput,
  type ResolvedSocialLink,
  type ResolvedSocialLinks,
} from "./social-links";

const MAX_LABEL_LENGTH = 40;
const MAX_URL_LENGTH = 500;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sanitizeSocialUrl(value: string | undefined): string {
  const url = value?.trim() ?? "";
  if (!url) return "";
  try {
    const parsed = new URL(url.startsWith("//") ? `https:${url}` : url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString().slice(0, MAX_URL_LENGTH);
  } catch {
    return "";
  }
}

function sanitizeLabel(value: string | undefined, fallback: string): string {
  const label = (value?.trim() || fallback).slice(0, MAX_LABEL_LENGTH);
  return label || fallback;
}

export function resolveSocialLinks(
  input: StoreSocialLinksInput | null | undefined,
): ResolvedSocialLinks {
  if (!input?.showOnInvoice) {
    return { visible: false, links: [] };
  }

  const links: ResolvedSocialLink[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const entry = input[platform];
    const url = sanitizeSocialUrl(entry?.url);
    if (!url) continue;
    links.push({
      platform,
      label: sanitizeLabel(entry?.label, SOCIAL_PLATFORM_LABELS[platform]),
      url,
    });
  }

  return { visible: links.length > 0, links };
}

function socialIconSvg(platform: SocialPlatform): string {
  switch (platform) {
    case "website":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.93 9h-3.07a16.4 16.4 0 0 0-1.14-4.03A8.03 8.03 0 0 1 19.93 11ZM12 4c.95 1.6 1.63 3.36 1.93 5.25H10.07C10.37 7.36 11.05 5.6 12 4ZM8.28 6.97A16.4 16.4 0 0 0 7.14 11H4.07a8.03 8.03 0 0 1 4.21-4.03ZM4.07 13h3.07c.32 1.46.86 2.82 1.57 4.03A8.03 8.03 0 0 1 4.07 13Zm7.93 7c-.95-1.6-1.63-3.36-1.93-5.25h3.86c-.3 1.89-.98 3.65-1.93 5.25Zm3.65-2.22c.71-1.21 1.25-2.57 1.57-4.03h3.07a8.03 8.03 0 0 1-4.64 4.03Z"/></svg>';
    case "instagram":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm11 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>';
    case "x":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.77L23 22h-6.7l-5.2-6.8L5.4 22H2.3l7.3-8.36L1 2h6.86l4.7 6.23L18.9 2Zm-1.18 18h1.87L7.08 3.93H5.08L17.72 20Z"/></svg>';
    case "facebook":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 22v-8h2.7l.4-3.1H13.5V9.1c0-.9.25-1.5 1.6-1.5h1.5V4.8c-.26-.04-1.16-.11-2.2-.11-2.18 0-3.67 1.33-3.67 3.76V10.9H8v3.1h2.73V22h2.77Z"/></svg>';
    case "linkedin":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.5 8.7H3.6V21h2.9V8.7ZM5.05 3a1.68 1.68 0 1 0 0 3.36 1.68 1.68 0 0 0 0-3.36ZM9.2 8.7H12v1.76h.04c.4-.75 1.38-1.54 2.84-1.54 3.04 0 3.6 2 3.6 4.6V21h-2.9v-6.2c0-1.48-.03-3.38-2.06-3.38-2.06 0-2.38 1.6-2.38 3.26V21H9.2V8.7Z"/></svg>';
    case "tiktok":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.6 5.82s.51.5 0 0A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.4 2.6-6.4 6.04 0 3.59 3.11 6.05 6.67 5.04 3.44-.94 5.82-4.17 5.82-7.66V8.73a6.45 6.45 0 0 0 3.84 1.52V7.15a4.85 4.85 0 0 1-1-.33h.04Z"/></svg>';
    case "youtube":
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.04 5 12 5 12 5s-6.04 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.76 1.77C5.96 19 12 19 12 19s6.04 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z"/></svg>';
  }
}

export function buildSocialLinksHtml(links: ResolvedSocialLinks): string {
  if (!links.visible || links.links.length === 0) return "";

  const items = links.links
    .map(
      (link) =>
        `<a class="social-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(link.label)}">
          <span class="social-icon">${socialIconSvg(link.platform)}</span>
          <span class="social-label">${esc(link.label)}</span>
        </a>`,
    )
    .join("");

  return `<div class="social-links">${items}</div>`;
}

export function parseSocialLinksFromForm(
  body: Record<string, unknown>,
): StoreSocialLinksInput {
  const showOnInvoice =
    body.showSocialLinks === "on" || body.showSocialLinks === true;
  const read = (platform: SocialPlatform): SocialLinkInput => {
    const cap = capitalizeSocialPlatform(platform);
    return {
      label:
        typeof body[`social${cap}Label`] === "string"
          ? (body[`social${cap}Label`] as string)
          : "",
      url:
        typeof body[`social${cap}Url`] === "string"
          ? (body[`social${cap}Url`] as string)
          : "",
    };
  };

  return {
    showOnInvoice,
    website: read("website"),
    instagram: read("instagram"),
    x: read("x"),
    facebook: read("facebook"),
    linkedin: read("linkedin"),
    tiktok: read("tiktok"),
    youtube: read("youtube"),
  };
}
