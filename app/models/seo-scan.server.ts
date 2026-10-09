import type {SeoScanResult} from '@prisma/client';

import prisma from '../db.server';
import {
  analyzeSeoBatch,
  suggestHandle,
  suggestHeadings,
  suggestImageAlt,
  suggestSeoMeta,
  type SeoScanItem,
  type SeoSuggestion,
} from './groq-seo.server';

export type {SeoScanItem};

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {variables?: Record<string, unknown>},
  ) => Promise<Response>;
};

type ImageScanItem = {
  id: string;
  type: 'product_image' | 'collection_image';
  alt_text: string;
  image_url: string;
  product_id?: string;
  product_title?: string;
  product_handle?: string;
  collection_id?: string;
  collection_title?: string;
  collection_handle?: string;
};

const SEO_TITLE_MIN = 30;
const SEO_TITLE_MAX = 60;
const SEO_DESC_MIN = 120;
const SEO_DESC_MAX = 160;
const HANDLE_MAX_LENGTH = 60;
const SCAN_COOLDOWN_MS = 60_000;

const IMAGE_TYPES = new Set(['product_image', 'collection_image']);
const HANDLE_TYPES = new Set([
  'product_handle',
  'collection_handle',
  'page_handle',
]);
const HEADING_TYPES = new Set([
  'product_heading',
  'page_heading',
  'blog_article_heading',
]);

function normalizeShop(shop: string) {
  return shop.toString().trim().toLowerCase();
}

function stripHtml(html: string) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function graphqlJson<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(
    query,
    variables ? {variables} : undefined,
  );
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{message: string}>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  if (!json.data) {
    throw new Error('Shopify GraphQL returned no data');
  }
  return json.data;
}

/** Port of SeoAnalyzerService.structural_issues */
export function structuralIssues(item: SeoScanItem): string[] {
  const issues: string[] = [];
  const title = (item.seo.title || '').trim();
  const desc = (item.seo.description || '').trim();

  if (!title) issues.push('Missing SEO title');
  else if (title.length < SEO_TITLE_MIN) {
    issues.push(
      `SEO title too short (${title.length} chars, min ${SEO_TITLE_MIN})`,
    );
  } else if (title.length > SEO_TITLE_MAX) {
    issues.push(
      `SEO title too long (${title.length} chars, max ${SEO_TITLE_MAX})`,
    );
  }

  if (!desc) issues.push('Missing SEO description');
  else if (desc.length < SEO_DESC_MIN) {
    issues.push(
      `SEO description too short (${desc.length} chars, min ${SEO_DESC_MIN})`,
    );
  } else if (desc.length > SEO_DESC_MAX) {
    issues.push(
      `SEO description too long (${desc.length} chars, max ${SEO_DESC_MAX})`,
    );
  }

  return issues;
}

/** Port of SeoAnalyzerService.url_handle_issues */
export function urlHandleIssues(item: {
  handle?: string | null;
}): string[] {
  const issues: string[] = [];
  const handle = (item.handle || '').trim();
  if (!handle) return ['Missing URL handle'];

  if (handle.length > HANDLE_MAX_LENGTH) {
    issues.push(
      `Handle too long (${handle.length} chars, max ${HANDLE_MAX_LENGTH})`,
    );
  }
  if (/[A-Z]/.test(handle)) issues.push('Handle contains uppercase letters');
  if (/[^a-z0-9-]/.test(handle)) {
    issues.push('Handle contains special characters');
  }
  if (/[a-f0-9]{7,}/.test(handle)) {
    issues.push('Handle appears to contain random characters');
  }
  return issues;
}

/** Port of SeoAnalyzerService.image_alt_issues */
export function imageAltIssues(image: {alt_text?: string | null}): string[] {
  const issues: string[] = [];
  const alt = (image.alt_text || '').trim();
  if (!alt) {
    issues.push('Missing alt text');
  } else if (/^(image|photo|picture|product|img)$/i.test(alt)) {
    issues.push('Alt text is too generic');
  }
  return issues;
}

/** Port of SeoAnalyzerService.heading_issues */
export function headingIssues(item: {body_html?: string | null}): string[] {
  const issues: string[] = [];
  const html = item.body_html?.toString() || '';
  const cleaned = html.replace(
    /<(script|style)[^>]*>.*?<\/\1>/gim,
    '',
  );

  const h1Tags = [...cleaned.matchAll(/<h1[^>]*>(.*?)<\/h1>/gim)];
  const h2Tags = [...cleaned.matchAll(/<h2[^>]*>(.*?)<\/h2>/gim)];
  const h1Count = h1Tags.length;
  const h2Count = h2Tags.length;

  if (h1Count === 0) issues.push('Missing H1 tag');
  if (h1Count > 1) issues.push(`Multiple H1 tags (${h1Count} found)`);

  if (h2Count > 0 && h1Count === 0) {
    issues.push('H2 used without any H1');
  } else if (h2Count > 0 && h1Count > 0) {
    const firstH1 = cleaned.search(/<h1[^>]*>/i);
    const firstH2 = cleaned.search(/<h2[^>]*>/i);
    if (firstH2 >= 0 && firstH1 >= 0 && firstH2 < firstH1) {
      issues.push('H2 appears before H1');
    }
  }

  for (const match of h1Tags) {
    if (!stripHtml(match[1] || '')) {
      issues.push('Empty H1 tag');
      break;
    }
  }
  for (const match of h2Tags) {
    if (!stripHtml(match[1] || '')) {
      issues.push('Empty H2 tag');
      break;
    }
  }

  if (h2Count === 0 && stripHtml(html).length > 50) {
    issues.push('Missing H2 tag');
  }

  return issues;
}

async function fetchProductsSeo(
  admin: AdminGraphqlClient,
): Promise<SeoScanItem[]> {
  const items: SeoScanItem[] = [];
  let cursor: string | null = null;

  for (;;) {
    const data: {
      products: {
        pageInfo: {hasNextPage: boolean; endCursor: string | null};
        edges: Array<{
          node: {
            id: string;
            title: string;
            handle: string;
            descriptionHtml: string | null;
            seo: {title: string | null; description: string | null} | null;
          };
        }>;
      };
    } = await graphqlJson(
      admin,
      `#graphql
        query SeoGetProducts($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                handle
                descriptionHtml
                seo { title description }
              }
            }
          }
        }
      `,
      {cursor},
    );

    for (const edge of data.products.edges) {
      const node = edge.node;
      items.push({
        id: node.id,
        title: node.title,
        handle: node.handle,
        body_html: node.descriptionHtml || '',
        type: 'product',
        seo: {
          title: node.seo?.title ?? null,
          description: node.seo?.description ?? null,
        },
      });
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return items;
}

async function fetchCollectionsSeo(
  admin: AdminGraphqlClient,
): Promise<SeoScanItem[]> {
  const items: SeoScanItem[] = [];
  let cursor: string | null = null;

  for (;;) {
    const data: {
      collections: {
        pageInfo: {hasNextPage: boolean; endCursor: string | null};
        edges: Array<{
          node: {
            id: string;
            title: string;
            handle: string;
            description: string | null;
            seo: {title: string | null; description: string | null} | null;
          };
        }>;
      };
    } = await graphqlJson(
      admin,
      `#graphql
        query SeoGetCollections($cursor: String) {
          collections(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                handle
                description
                seo { title description }
              }
            }
          }
        }
      `,
      {cursor},
    );

    for (const edge of data.collections.edges) {
      const node = edge.node;
      items.push({
        id: node.id,
        title: node.title,
        handle: node.handle,
        body_html: node.description || '',
        type: 'collection',
        seo: {
          title: node.seo?.title ?? null,
          description: node.seo?.description ?? null,
        },
      });
    }

    if (!data.collections.pageInfo.hasNextPage) break;
    cursor = data.collections.pageInfo.endCursor;
  }

  return items;
}

async function fetchPagesSeo(
  admin: AdminGraphqlClient,
): Promise<SeoScanItem[]> {
  const items: SeoScanItem[] = [];
  let cursor: string | null = null;

  for (;;) {
    const data: {
      pages: {
        pageInfo: {hasNextPage: boolean; endCursor: string | null};
        edges: Array<{
          node: {
            id: string;
            title: string;
            handle: string;
            body: string | null;
            metafield: {value: string} | null;
            seoDescription: {value: string} | null;
          };
        }>;
      };
    } = await graphqlJson(
      admin,
      `#graphql
        query SeoGetPages($cursor: String) {
          pages(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                handle
                body
                metafield(namespace: "global", key: "title_tag") { value }
                seoDescription: metafield(namespace: "global", key: "description_tag") { value }
              }
            }
          }
        }
      `,
      {cursor},
    );

    for (const edge of data.pages.edges) {
      const node = edge.node;
      items.push({
        id: node.id,
        title: node.title,
        handle: node.handle,
        body_html: node.body || '',
        type: 'page',
        seo: {
          title: node.metafield?.value ?? null,
          description: node.seoDescription?.value ?? null,
        },
      });
    }

    if (!data.pages.pageInfo.hasNextPage) break;
    cursor = data.pages.pageInfo.endCursor;
  }

  return items;
}

async function fetchBlogArticlesSeo(
  admin: AdminGraphqlClient,
): Promise<SeoScanItem[]> {
  const blogs: Array<{id: string; handle: string}> = [];
  let blogCursor: string | null = null;

  for (;;) {
    const data: {
      blogs: {
        pageInfo: {hasNextPage: boolean; endCursor: string | null};
        edges: Array<{node: {id: string; handle: string}}>;
      };
    } = await graphqlJson(
      admin,
      `#graphql
        query SeoGetBlogs($cursor: String) {
          blogs(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges { node { id handle } }
          }
        }
      `,
      {cursor: blogCursor},
    );

    for (const edge of data.blogs.edges) {
      blogs.push({id: edge.node.id, handle: edge.node.handle});
    }

    if (!data.blogs.pageInfo.hasNextPage) break;
    blogCursor = data.blogs.pageInfo.endCursor;
  }

  const items: SeoScanItem[] = [];

  for (const blog of blogs) {
    let cursor: string | null = null;
    for (;;) {
      const data: {
        blog: {
          articles: {
            pageInfo: {hasNextPage: boolean; endCursor: string | null};
            edges: Array<{
              node: {
                id: string;
                title: string;
                handle: string;
                body: string | null;
                metafield: {value: string} | null;
                seoDescription: {value: string} | null;
              };
            }>;
          };
        } | null;
      } = await graphqlJson(
        admin,
        `#graphql
          query SeoGetBlogArticles($blogId: ID!, $cursor: String) {
            blog(id: $blogId) {
              articles(first: 50, after: $cursor) {
                pageInfo { hasNextPage endCursor }
                edges {
                  node {
                    id
                    title
                    handle
                    body
                    metafield(namespace: "global", key: "title_tag") { value }
                    seoDescription: metafield(namespace: "global", key: "description_tag") { value }
                  }
                }
              }
            }
          }
        `,
        {blogId: blog.id, cursor},
      );

      const articles = data.blog?.articles;
      if (!articles) break;

      for (const edge of articles.edges) {
        const node = edge.node;
        items.push({
          id: node.id,
          title: node.title,
          handle: node.handle,
          body_html: node.body || '',
          type: 'blog_article',
          blog_handle: blog.handle,
          seo: {
            title: node.metafield?.value ?? null,
            description: node.seoDescription?.value ?? null,
          },
        });
      }

      if (!articles.pageInfo.hasNextPage) break;
      cursor = articles.pageInfo.endCursor;
    }
  }

  return items;
}

async function fetchProductImages(
  admin: AdminGraphqlClient,
): Promise<ImageScanItem[]> {
  const items: ImageScanItem[] = [];
  let cursor: string | null = null;

  for (;;) {
    const data: {
      products: {
        pageInfo: {hasNextPage: boolean; endCursor: string | null};
        edges: Array<{
          node: {
            id: string;
            title: string;
            handle: string;
            media: {
              edges: Array<{
                node: {
                  id?: string;
                  image?: {altText: string | null; url: string | null} | null;
                };
              }>;
            };
          };
        }>;
      };
    } = await graphqlJson(
      admin,
      `#graphql
        query SeoGetProductImages($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                handle
                media(first: 50) {
                  edges {
                    node {
                      ... on MediaImage {
                        id
                        image { altText url }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {cursor},
    );

    for (const edge of data.products.edges) {
      const node = edge.node;
      for (const mediaEdge of node.media.edges) {
        const media = mediaEdge.node;
        if (!media.id || !media.image) continue;
        items.push({
          id: media.id,
          type: 'product_image',
          product_id: node.id,
          product_title: node.title,
          product_handle: node.handle,
          alt_text: media.image.altText || '',
          image_url: media.image.url || '',
        });
      }
    }

    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return items;
}

async function fetchCollectionImages(
  admin: AdminGraphqlClient,
): Promise<ImageScanItem[]> {
  const items: ImageScanItem[] = [];
  let cursor: string | null = null;

  for (;;) {
    const data: {
      collections: {
        pageInfo: {hasNextPage: boolean; endCursor: string | null};
        edges: Array<{
          node: {
            id: string;
            title: string;
            handle: string;
            image: {altText: string | null; url: string | null} | null;
          };
        }>;
      };
    } = await graphqlJson(
      admin,
      `#graphql
        query SeoGetCollectionImages($cursor: String) {
          collections(first: 50, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                handle
                image { altText url }
              }
            }
          }
        }
      `,
      {cursor},
    );

    for (const edge of data.collections.edges) {
      const node = edge.node;
      if (!node.image) continue;
      items.push({
        id: node.id,
        type: 'collection_image',
        collection_id: node.id,
        collection_title: node.title,
        collection_handle: node.handle,
        alt_text: node.image.altText || '',
        image_url: node.image.url || '',
      });
    }

    if (!data.collections.pageInfo.hasNextPage) break;
    cursor = data.collections.pageInfo.endCursor;
  }

  return items;
}

function buildUrl(
  item: Pick<SeoScanItem, 'type' | 'handle' | 'blog_handle'>,
) {
  switch (item.type) {
    case 'product':
    case 'product_handle':
    case 'product_heading':
      return `/products/${item.handle}`;
    case 'collection':
    case 'collection_handle':
      return `/collections/${item.handle}`;
    case 'page':
    case 'page_handle':
    case 'page_heading':
      return `/pages/${item.handle}`;
    case 'blog_article':
    case 'blog_article_heading':
      return `/blogs/${item.blog_handle || ''}/${item.handle}`;
    default:
      return null;
  }
}

async function upsertSeoItem(
  shop: string,
  item: SeoScanItem,
  issues: string[],
) {
  const domain = normalizeShop(shop);
  return prisma.seoScanResult.upsert({
    where: {
      shop_shopifyGid: {shop: domain, shopifyGid: item.id},
    },
    create: {
      shop: domain,
      shopifyGid: item.id,
      resourceType: item.type,
      resourceHandle: item.handle,
      resourceName: item.title,
      resourceUrl: buildUrl(item),
      currentSeoTitle: item.seo.title,
      currentSeoDescription: item.seo.description,
      resourceBodySummary: stripHtml(item.body_html).slice(0, 500),
      issues,
      status: issues.length ? 'needs_fix' : 'optimized',
      lastScannedAt: new Date(),
      ...(issues.length
        ? {optimizedSeoTitle: null, optimizedSeoDescription: null}
        : {}),
    },
    update: {
      resourceType: item.type,
      resourceHandle: item.handle,
      resourceName: item.title,
      resourceUrl: buildUrl(item),
      currentSeoTitle: item.seo.title,
      currentSeoDescription: item.seo.description,
      resourceBodySummary: stripHtml(item.body_html).slice(0, 500),
      issues,
      status: issues.length ? 'needs_fix' : 'optimized',
      lastScannedAt: new Date(),
      ...(issues.length
        ? {optimizedSeoTitle: null, optimizedSeoDescription: null}
        : {}),
    },
  });
}

async function upsertImageItem(
  shop: string,
  image: ImageScanItem,
  issues: string[],
) {
  const domain = normalizeShop(shop);
  const parentName = image.product_title || image.collection_title || null;
  const parentHandle =
    image.product_handle || image.collection_handle || null;
  const parentGid = image.product_id || image.collection_id || null;

  return prisma.seoScanResult.upsert({
    where: {
      shop_shopifyGid: {shop: domain, shopifyGid: image.id},
    },
    create: {
      shop: domain,
      shopifyGid: image.id,
      resourceType: image.type,
      resourceHandle: parentHandle,
      resourceName: parentName,
      resourceUrl: image.image_url || null,
      imageGid: image.id,
      currentImageAlt: image.alt_text || null,
      resourceBodySummary: parentGid,
      issues,
      status: issues.length ? 'needs_fix' : 'optimized',
      lastScannedAt: new Date(),
      ...(issues.length ? {optimizedImageAlt: null} : {}),
    },
    update: {
      resourceType: image.type,
      resourceHandle: parentHandle,
      resourceName: parentName,
      resourceUrl: image.image_url || null,
      imageGid: image.id,
      currentImageAlt: image.alt_text || null,
      resourceBodySummary: parentGid,
      issues,
      status: issues.length ? 'needs_fix' : 'optimized',
      lastScannedAt: new Date(),
      ...(issues.length ? {optimizedImageAlt: null} : {}),
    },
  });
}

async function upsertHandleItem(
  shop: string,
  item: SeoScanItem & {type: string},
  issues: string[],
) {
  const domain = normalizeShop(shop);
  const scopedGid = `${item.id}::handle`;

  return prisma.seoScanResult.upsert({
    where: {
      shop_shopifyGid: {shop: domain, shopifyGid: scopedGid},
    },
    create: {
      shop: domain,
      shopifyGid: scopedGid,
      resourceType: item.type,
      resourceHandle: item.handle,
      resourceName: item.title,
      resourceUrl: buildUrl(item),
      currentHandle: item.handle,
      issues,
      status: issues.length ? 'needs_fix' : 'optimized',
      lastScannedAt: new Date(),
      ...(issues.length ? {optimizedHandle: null} : {}),
    },
    update: {
      resourceType: item.type,
      resourceHandle: item.handle,
      resourceName: item.title,
      resourceUrl: buildUrl(item),
      currentHandle: item.handle,
      issues,
      status: issues.length ? 'needs_fix' : 'optimized',
      lastScannedAt: new Date(),
      ...(issues.length ? {optimizedHandle: null} : {}),
    },
  });
}

async function upsertHeadingItem(
  shop: string,
  item: SeoScanItem & {type: string},
  issues: string[],
) {
  const domain = normalizeShop(shop);
  const scopedGid = `${item.id}::heading`;
  const html = item.body_html?.toString() || '';
  const cleaned = html.replace(/<(script|style)[^>]*>.*?<\/\1>/gim, '');
  const h1Match = cleaned.match(/<h1[^>]*>(.*?)<\/h1>/im);
  const h1Text = h1Match ? stripHtml(h1Match[1] || '') || null : null;

  return prisma.seoScanResult.upsert({
    where: {
      shop_shopifyGid: {shop: domain, shopifyGid: scopedGid},
    },
    create: {
      shop: domain,
      shopifyGid: scopedGid,
      resourceType: item.type,
      resourceHandle: item.handle,
      resourceName: item.title,
      resourceUrl: buildUrl(item),
      resourceBodySummary: html.slice(0, 5000),
      currentSeoTitle: h1Text,
      issues,
      status: issues.length ? 'needs_fix' : 'optimized',
      lastScannedAt: new Date(),
    },
    update: {
      resourceType: item.type,
      resourceHandle: item.handle,
      resourceName: item.title,
      resourceUrl: buildUrl(item),
      resourceBodySummary: html.slice(0, 5000),
      currentSeoTitle: h1Text,
      issues,
      status: issues.length ? 'needs_fix' : 'optimized',
      lastScannedAt: new Date(),
    },
  });
}

export type SerializedSeoResult = {
  id: string;
  shopify_gid: string;
  resource_type: string;
  resource_name: string | null;
  resource_url: string | null;
  resource_handle: string | null;
  resource_body_summary: string | null;
  current_seo_title: string | null;
  current_seo_description: string | null;
  optimized_seo_title: string | null;
  optimized_seo_description: string | null;
  image_gid: string | null;
  current_image_alt: string | null;
  optimized_image_alt: string | null;
  current_handle: string | null;
  optimized_handle: string | null;
  issues: string[];
  status: string;
  last_scanned_at: string | null;
  last_optimized_at: string | null;
};

export function serializeSeoResult(r: SeoScanResult): SerializedSeoResult {
  const issues = Array.isArray(r.issues)
    ? (r.issues as unknown[]).map(String)
    : [];
  return {
    id: r.id,
    shopify_gid: r.shopifyGid,
    resource_type: r.resourceType,
    resource_name: r.resourceName,
    resource_url: r.resourceUrl,
    resource_handle: r.resourceHandle,
    resource_body_summary: r.resourceBodySummary,
    current_seo_title: r.currentSeoTitle,
    current_seo_description: r.currentSeoDescription,
    optimized_seo_title: r.optimizedSeoTitle,
    optimized_seo_description: r.optimizedSeoDescription,
    image_gid: r.imageGid,
    current_image_alt: r.currentImageAlt,
    optimized_image_alt: r.optimizedImageAlt,
    current_handle: r.currentHandle,
    optimized_handle: r.optimizedHandle,
    issues,
    status: r.status,
    last_scanned_at: r.lastScannedAt?.toISOString() ?? null,
    last_optimized_at: r.lastOptimizedAt?.toISOString() ?? null,
  };
}

export async function listScanResults(shop: string) {
  const rows = await prisma.seoScanResult.findMany({
    where: {shop: normalizeShop(shop)},
    orderBy: [{resourceType: 'asc'}, {resourceName: 'asc'}],
  });
  const items = rows.map(serializeSeoResult);
  return {
    items,
    summary: {
      total: items.length,
      needs_fix: items.filter((i) => i.status === 'needs_fix').length,
      optimized: items.filter((i) => i.status === 'optimized').length,
    },
  };
}

async function fetchFamily(
  label: string,
  fn: () => Promise<SeoScanItem[]>,
): Promise<{ok: boolean; items: SeoScanItem[]}> {
  try {
    return {ok: true, items: await fn()};
  } catch (error) {
    console.warn(
      `[SeoScan] ${label} skipped:`,
      error instanceof Error ? error.message : error,
    );
    return {ok: false, items: []};
  }
}

async function purgeStaleScanRows(
  shop: string,
  scannedTypes: string[],
  seenGids: Set<string>,
) {
  if (!scannedTypes.length) return;

  await prisma.seoScanResult.deleteMany({
    where: {
      shop: normalizeShop(shop),
      resourceType: {in: scannedTypes},
      ...(seenGids.size
        ? {shopifyGid: {notIn: [...seenGids]}}
        : {}),
    },
  });
}

export async function runScan(
  admin: AdminGraphqlClient,
  shop: string,
): Promise<
  ReturnType<typeof listScanResults> extends Promise<infer T> ? T : never
> {
  if (!process.env.GROQ_API_KEY?.trim()) {
    throw new Error('GROQ_API_KEY is not set');
  }

  const domain = normalizeShop(shop);
  const lastScan = await prisma.seoScanResult.aggregate({
    where: {shop: domain},
    _max: {lastScannedAt: true},
  });
  const lastAt = lastScan._max.lastScannedAt;
  if (lastAt && Date.now() - lastAt.getTime() < SCAN_COOLDOWN_MS) {
    throw new Error('Scan cooldown: please wait before scanning again.');
  }

  const seenGids = new Set<string>();
  const scannedTypes = new Set<string>();

  const products = await fetchFamily('Products', () =>
    fetchProductsSeo(admin),
  );
  const collections = await fetchFamily('Collections', () =>
    fetchCollectionsSeo(admin),
  );
  const pages = await fetchFamily('Pages', () => fetchPagesSeo(admin));
  const blogs = await fetchFamily('Blog articles', () =>
    fetchBlogArticlesSeo(admin),
  );

  const allItems: SeoScanItem[] = [];
  if (products.ok) {
    allItems.push(...products.items);
    scannedTypes.add('product');
  }
  if (collections.ok) {
    allItems.push(...collections.items);
    scannedTypes.add('collection');
  }
  if (pages.ok) {
    allItems.push(...pages.items);
    scannedTypes.add('page');
  }
  if (blogs.ok) {
    allItems.push(...blogs.items);
    scannedTypes.add('blog_article');
  }

  if (allItems.length) {
    const structuralFail: Array<SeoScanItem & {issues: string[]}> = [];
    const aiCandidates: SeoScanItem[] = [];

    for (const item of allItems) {
      const issues = structuralIssues(item);
      if (issues.length) structuralFail.push({...item, issues});
      else aiCandidates.push(item);
    }

    const aiIssuesMap = new Map<string, string[]>();
    for (let i = 0; i < aiCandidates.length; i += 10) {
      const batch = aiCandidates.slice(i, i + 10);
      try {
        const results = await analyzeSeoBatch(batch);
        for (const result of results) {
          aiIssuesMap.set(result.shopify_gid, result.issues);
        }
      } catch (error) {
        console.error('[SeoScan] Layer2 error:', error);
        for (const item of batch) {
          aiIssuesMap.set(item.id, []);
        }
      }
    }

    for (const item of structuralFail) {
      await upsertSeoItem(domain, item, item.issues);
      seenGids.add(item.id);
    }
    for (const item of aiCandidates) {
      await upsertSeoItem(domain, item, aiIssuesMap.get(item.id) || []);
      seenGids.add(item.id);
    }
  }

  // Image alt text scan
  const imageItems: ImageScanItem[] = [];
  try {
    imageItems.push(...(await fetchProductImages(admin)));
    scannedTypes.add('product_image');
  } catch (error) {
    console.warn(
      '[SeoScan] Product images skipped:',
      error instanceof Error ? error.message : error,
    );
  }
  try {
    imageItems.push(...(await fetchCollectionImages(admin)));
    scannedTypes.add('collection_image');
  } catch (error) {
    console.warn(
      '[SeoScan] Collection images skipped:',
      error instanceof Error ? error.message : error,
    );
  }

  for (const image of imageItems) {
    await upsertImageItem(domain, image, imageAltIssues(image));
    seenGids.add(image.id);
  }

  // URL handle scan — products, collections, pages
  const handleSourceTypes = ['product', 'collection', 'page'] as const;
  for (const sourceType of handleSourceTypes) {
    if (!scannedTypes.has(sourceType)) continue;
    scannedTypes.add(`${sourceType}_handle`);
  }

  const handleItems = allItems
    .filter((i) =>
      (handleSourceTypes as readonly string[]).includes(i.type),
    )
    .map((i) => ({...i, type: `${i.type}_handle`}));

  for (const item of handleItems) {
    await upsertHandleItem(domain, item, urlHandleIssues(item));
    seenGids.add(`${item.id}::handle`);
  }

  // Heading scan — products, pages, blog articles
  const headingSourceTypes = ['product', 'page', 'blog_article'] as const;
  for (const sourceType of headingSourceTypes) {
    if (!scannedTypes.has(sourceType)) continue;
    scannedTypes.add(`${sourceType}_heading`);
  }

  const headingItems = allItems
    .filter((i) =>
      (headingSourceTypes as readonly string[]).includes(i.type),
    )
    .map((i) => ({...i, type: `${i.type}_heading`}));

  for (const item of headingItems) {
    await upsertHeadingItem(domain, item, headingIssues(item));
    seenGids.add(`${item.id}::heading`);
  }

  // Drop rows for resources that no longer exist in Shopify (previous catalog).
  await purgeStaleScanRows(domain, [...scannedTypes], seenGids);

  // DuplicateContentService intentionally skipped in this port.

  return listScanResults(domain);
}

export async function previewOptimize(
  shop: string,
  id: string,
): Promise<SeoSuggestion> {
  const row = await prisma.seoScanResult.findFirst({
    where: {id, shop: normalizeShop(shop)},
  });
  if (!row) throw new Error('Item not found');

  if (IMAGE_TYPES.has(row.resourceType)) {
    const alt_text = await suggestImageAlt({
      resourceName: row.resourceName,
      currentImageAlt: row.currentImageAlt,
    });
    return {alt_text};
  }

  if (HANDLE_TYPES.has(row.resourceType)) {
    const handle = await suggestHandle({
      resourceName: row.resourceName,
      currentHandle: row.currentHandle,
      resourceType: row.resourceType,
    });
    return {handle};
  }

  if (HEADING_TYPES.has(row.resourceType)) {
    return suggestHeadings({
      resourceName: row.resourceName,
      currentSeoTitle: row.currentSeoTitle,
      issues: row.issues,
    });
  }

  return suggestSeoMeta({
    resourceType: row.resourceType,
    resourceName: row.resourceName,
    currentSeoTitle: row.currentSeoTitle,
    currentSeoDescription: row.currentSeoDescription,
    resourceBodySummary: row.resourceBodySummary,
    issues: row.issues,
  });
}
