export const SOCIAL_PLATFORMS = [
  "website",
  "instagram",
  "x",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  website: "Website",
  instagram: "Instagram",
  x: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export interface SocialLinkInput {
  label?: string;
  url?: string;
}

export interface StoreSocialLinksInput {
  showOnInvoice?: boolean;
  website?: SocialLinkInput;
  instagram?: SocialLinkInput;
  x?: SocialLinkInput;
  facebook?: SocialLinkInput;
  linkedin?: SocialLinkInput;
  tiktok?: SocialLinkInput;
  youtube?: SocialLinkInput;
}

export interface ResolvedSocialLink {
  platform: SocialPlatform;
  label: string;
  url: string;
}

export interface ResolvedSocialLinks {
  visible: boolean;
  links: ResolvedSocialLink[];
}

function capitalize(platform: SocialPlatform): string {
  if (platform === "x") return "X";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

export function socialLinksFormFieldNames(): Array<{
  labelKey: string;
  urlKey: string;
  platform: SocialPlatform;
}> {
  return SOCIAL_PLATFORMS.map((platform) => ({
    platform,
    labelKey: `social${capitalize(platform)}Label`,
    urlKey: `social${capitalize(platform)}Url`,
  }));
}

export { capitalize as capitalizeSocialPlatform };
