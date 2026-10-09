export const SCAN_STEPS = [
  'Fetching products…',
  'Fetching collections…',
  'Fetching pages…',
  'Fetching blogs…',
  'Scanning images…',
  'Analysing metadata…',
  'Done!',
] as const;

export const SEO_TYPES = ['product', 'collection', 'page', 'blog'] as const;
export const IMAGE_TYPES = ['product_image', 'collection_image'] as const;
export const HANDLE_TYPES = [
  'product_handle',
  'collection_handle',
  'page_handle',
] as const;
export const HEADING_TYPES = [
  'product_heading',
  'page_heading',
  'blog_article_heading',
] as const;

export const SEO_TAB_TYPES = [
  'all',
  'product',
  'collection',
  'page',
  'blog',
] as const;
export const SEO_TAB_LABELS = [
  'All',
  'Products',
  'Collections',
  'Pages',
  'Blogs',
] as const;

export const IMAGE_TAB_TYPES = [
  'all',
  'product_image',
  'collection_image',
] as const;
export const IMAGE_TAB_LABELS = [
  'All',
  'Product Images',
  'Collection Images',
] as const;

export const URL_TAB_TYPES = [
  'all',
  'product_handle',
  'collection_handle',
  'page_handle',
] as const;
export const URL_TAB_LABELS = [
  'All',
  'Products',
  'Collections',
  'Pages',
] as const;

export const HEADING_TAB_TYPES = [
  'all',
  'product_heading',
  'page_heading',
  'blog_article_heading',
] as const;
export const HEADING_TAB_LABELS = ['All', 'Products', 'Pages', 'Blogs'] as const;

export type FeatureSectionId = 0 | 1 | 2 | 3;

export const FEATURE_CARDS: Array<{
  id: FeatureSectionId;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    id: 0,
    title: 'SEO Titles & Descriptions',
    description:
      'Scan and fix missing, too short, or too long meta titles and descriptions across products, collections, pages, and blogs.',
    icon: 'search',
  },
  {
    id: 1,
    title: 'Image Alt Text',
    description:
      'Find images with missing or generic alt text and auto-generate descriptive, keyword-rich alternatives.',
    icon: 'image',
  },
  {
    id: 2,
    title: 'URL Handle Health',
    description:
      'Detect handles with random characters, poor keywords, or SEO issues and generate clean, descriptive slugs.',
    icon: 'link',
  },
  {
    id: 3,
    title: 'Heading Tag Validator',
    description:
      'Audit H1 and H2 tags across products, pages, and blogs for missing, duplicate, or incorrectly structured headings.',
    icon: 'text-title',
  },
];

export type BadgeTone =
  | 'info'
  | 'success'
  | 'warning'
  | 'critical'
  | 'caution'
  | 'neutral'
  | 'auto';

export const TYPE_BADGE_MAP: Record<
  string,
  {tone: BadgeTone; label: string}
> = {
  product: {tone: 'info', label: 'Product'},
  collection: {tone: 'warning', label: 'Collection'},
  page: {tone: 'caution', label: 'Page'},
  blog: {tone: 'success', label: 'Blog'},
  product_image: {tone: 'info', label: 'Product Image'},
  collection_image: {tone: 'info', label: 'Collection Image'},
  product_handle: {tone: 'info', label: 'Product URL'},
  collection_handle: {tone: 'warning', label: 'Collection URL'},
  page_handle: {tone: 'caution', label: 'Page URL'},
  product_heading: {tone: 'info', label: 'Product'},
  page_heading: {tone: 'caution', label: 'Page'},
  blog_article_heading: {tone: 'success', label: 'Blog'},
};

/** Normalize stored resource_type for UI grouping (blog_article → blog). */
export function normalizeItemType(resourceType: string): string {
  return resourceType === 'blog_article' ? 'blog' : resourceType;
}

export function adminEditUrl(
  shopDomain: string,
  gid: string,
  resourceType: string,
  resourceUrl?: string | null,
): string | null {
  if (resourceUrl && /\/admin\//.test(resourceUrl)) {
    return resourceUrl;
  }

  const baseType = resourceType
    .replace(/_handle$/, '')
    .replace(/_image$/, '')
    .replace(/_heading$/, '');
  const cleanGid = (gid || '')
    .replace(/::handle$/, '')
    .replace(/::heading$/, '');
  const numericId = cleanGid.split('/').pop();
  if (!shopDomain || !numericId) {
    return resourceUrl || null;
  }

  const pathMap: Record<string, string> = {
    product: 'products',
    collection: 'collections',
    page: 'pages',
    blog: 'articles',
    blog_article: 'articles',
  };
  const path = pathMap[baseType] || 'products';
  const domain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${domain}/admin/${path}/${numericId}`;
}
