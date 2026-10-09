import prisma from '../db.server';
import {
  suggestHandle,
  suggestHeadings,
  suggestImageAlt,
  suggestSeoMeta,
  type SeoSuggestion,
} from './groq-seo.server';
import {serializeSeoResult, type SerializedSeoResult} from './seo-scan.server';

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {variables?: Record<string, unknown>},
  ) => Promise<Response>;
};

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

function assertNoUserErrors(
  errors: Array<{field?: string[]; message: string}> | undefined,
) {
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, '').trim();
}

/** Port of SeoOptimizeService#fix_headings */
export function fixHeadings(
  html: string,
  h1Text: string,
  h2Text?: string | null,
): string {
  const safeH1 = stripHtml(h1Text.toString());
  const safeH2 = h2Text ? stripHtml(h2Text.toString()) || null : null;
  if (!safeH1) return html;

  const withoutH1 = html.toString().replace(/<h1[^>]*>.*?<\/h1>/gim, '');
  const withoutEmpty = withoutH1.replace(
    /<h2[^>]*>\s*(<br\s*\/?>)?\s*<\/h2>/gim,
    '',
  );
  const body = withoutEmpty.trim();
  const hasH2 = /<h2[^>]*>/i.test(body);

  if (safeH2 && !hasH2) {
    return `<h1>${safeH1}</h1>\n<h2>${safeH2}</h2>\n${body}`;
  }
  return `<h1>${safeH1}</h1>\n${body}`;
}

function buildUrlFromHandleType(resourceType: string, handle: string) {
  switch (resourceType) {
    case 'product_handle':
      return `/products/${handle}`;
    case 'collection_handle':
      return `/collections/${handle}`;
    case 'page_handle':
      return `/pages/${handle}`;
    default:
      return null;
  }
}

async function updateProductSeo(
  admin: AdminGraphqlClient,
  id: string,
  seoTitle: string,
  seoDescription: string,
) {
  const data = await graphqlJson<{
    productUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdateProduct(
        $id: ID!
        $seoTitle: String!
        $seoDescription: String!
      ) {
        productUpdate(
          product: {
            id: $id
            seo: {title: $seoTitle, description: $seoDescription}
          }
        ) {
          product { id seo { title description } }
          userErrors { field message }
        }
      }
    `,
    {id, seoTitle, seoDescription},
  );
  assertNoUserErrors(data.productUpdate.userErrors);
}

async function updateCollectionSeo(
  admin: AdminGraphqlClient,
  id: string,
  seoTitle: string,
  seoDescription: string,
) {
  const data = await graphqlJson<{
    collectionUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdateCollection(
        $id: ID!
        $seoTitle: String!
        $seoDescription: String!
      ) {
        collectionUpdate(
          collection: {
            id: $id
            seo: {title: $seoTitle, description: $seoDescription}
          }
        ) {
          collection { id seo { title description } }
          userErrors { field message }
        }
      }
    `,
    {id, seoTitle, seoDescription},
  );
  assertNoUserErrors(data.collectionUpdate.userErrors);
}

async function updatePageOrArticleSeoViaMetafields(
  admin: AdminGraphqlClient,
  id: string,
  seoTitle: string,
  seoDescription: string,
) {
  const data = await graphqlJson<{
    metafieldsSet: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key value }
          userErrors { field message }
        }
      }
    `,
    {
      metafields: [
        {
          ownerId: id,
          namespace: 'global',
          key: 'title_tag',
          value: seoTitle,
          type: 'single_line_text_field',
        },
        {
          ownerId: id,
          namespace: 'global',
          key: 'description_tag',
          value: seoDescription,
          type: 'multi_line_text_field',
        },
      ],
    },
  );
  assertNoUserErrors(data.metafieldsSet.userErrors);
}

async function updateProductImageAlt(
  admin: AdminGraphqlClient,
  imageGid: string,
  altText: string,
) {
  const data = await graphqlJson<{
    fileUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdateProductImageAlt($files: [FileUpdateInput!]!) {
        fileUpdate(files: $files) {
          files {
            ... on MediaImage {
              id
              image { altText }
            }
          }
          userErrors { field message }
        }
      }
    `,
    {files: [{id: imageGid, alt: altText}]},
  );
  assertNoUserErrors(data.fileUpdate.userErrors);
}

async function updateCollectionImageAlt(
  admin: AdminGraphqlClient,
  collectionId: string,
  altText: string,
) {
  const data = await graphqlJson<{
    collectionUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdateCollectionImageAlt($id: ID!, $altText: String!) {
        collectionUpdate(
          collection: {id: $id, image: {altText: $altText}}
        ) {
          collection { id image { altText } }
          userErrors { field message }
        }
      }
    `,
    {id: collectionId, altText},
  );
  assertNoUserErrors(data.collectionUpdate.userErrors);
}

async function updateProductHandle(
  admin: AdminGraphqlClient,
  id: string,
  handle: string,
) {
  const data = await graphqlJson<{
    productUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdateProductHandle($id: ID!, $handle: String!) {
        productUpdate(product: {id: $id, handle: $handle}) {
          product { id handle }
          userErrors { field message }
        }
      }
    `,
    {id, handle},
  );
  assertNoUserErrors(data.productUpdate.userErrors);
}

async function updateCollectionHandle(
  admin: AdminGraphqlClient,
  id: string,
  handle: string,
) {
  const data = await graphqlJson<{
    collectionUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdateCollectionHandle($id: ID!, $handle: String!) {
        collectionUpdate(collection: {id: $id, handle: $handle}) {
          collection { id handle }
          userErrors { field message }
        }
      }
    `,
    {id, handle},
  );
  assertNoUserErrors(data.collectionUpdate.userErrors);
}

async function updatePageHandle(
  admin: AdminGraphqlClient,
  id: string,
  handle: string,
) {
  const data = await graphqlJson<{
    pageUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdatePageHandle($id: ID!, $handle: String!) {
        pageUpdate(id: $id, page: {handle: $handle}) {
          page { id handle }
          userErrors { field message }
        }
      }
    `,
    {id, handle},
  );
  assertNoUserErrors(data.pageUpdate.userErrors);
}

async function getProductBodyHtml(admin: AdminGraphqlClient, id: string) {
  const data = await graphqlJson<{
    product: {descriptionHtml: string | null} | null;
  }>(
    admin,
    `#graphql
      query SeoGetProductBody($id: ID!) {
        product(id: $id) { id descriptionHtml }
      }
    `,
    {id},
  );
  return data.product?.descriptionHtml || '';
}

async function getPageBodyHtml(admin: AdminGraphqlClient, id: string) {
  const data = await graphqlJson<{
    page: {body: string | null} | null;
  }>(
    admin,
    `#graphql
      query SeoGetPageBody($id: ID!) {
        page(id: $id) { id body }
      }
    `,
    {id},
  );
  return data.page?.body || '';
}

async function getArticleBodyHtml(admin: AdminGraphqlClient, id: string) {
  const data = await graphqlJson<{
    node: {
      body?: string | null;
      blog?: {id: string} | null;
    } | null;
  }>(
    admin,
    `#graphql
      query SeoGetArticleBody($id: ID!) {
        node(id: $id) {
          ... on Article {
            id
            body
            blog { id }
          }
        }
      }
    `,
    {id},
  );
  return {
    body: data.node?.body || '',
    blog_id: data.node?.blog?.id || null,
  };
}

async function updateProductDescriptionHtml(
  admin: AdminGraphqlClient,
  id: string,
  descriptionHtml: string,
) {
  const data = await graphqlJson<{
    productUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdateProductDescription(
        $id: ID!
        $descriptionHtml: String!
      ) {
        productUpdate(
          product: {id: $id, descriptionHtml: $descriptionHtml}
        ) {
          product { id descriptionHtml }
          userErrors { field message }
        }
      }
    `,
    {id, descriptionHtml},
  );
  assertNoUserErrors(data.productUpdate.userErrors);
}

async function updatePageBodyHtml(
  admin: AdminGraphqlClient,
  id: string,
  body: string,
) {
  const data = await graphqlJson<{
    pageUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdatePageBody($id: ID!, $body: String!) {
        pageUpdate(id: $id, page: {body: $body}) {
          page { id body }
          userErrors { field message }
        }
      }
    `,
    {id, body},
  );
  assertNoUserErrors(data.pageUpdate.userErrors);
}

async function updateArticleBodyHtml(
  admin: AdminGraphqlClient,
  id: string,
  bodyHtml: string,
) {
  const data = await graphqlJson<{
    articleUpdate: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation SeoUpdateArticleBody($id: ID!, $body: String!) {
        articleUpdate(id: $id, article: {body: $body}) {
          article { id body }
          userErrors { field message }
        }
      }
    `,
    {id, body: bodyHtml},
  );
  assertNoUserErrors(data.articleUpdate.userErrors);
}

async function applySeoMetaOptimize(
  admin: AdminGraphqlClient,
  row: {
    id: string;
    shopifyGid: string;
    resourceType: string;
    resourceName: string | null;
    currentSeoTitle: string | null;
    currentSeoDescription: string | null;
    resourceBodySummary: string | null;
    issues: unknown;
  },
  overrides?: Partial<SeoSuggestion>,
) {
  let suggestion: SeoSuggestion;
  if (overrides?.meta_title && overrides?.meta_description) {
    suggestion = {
      meta_title: overrides.meta_title,
      meta_description: overrides.meta_description,
    };
  } else {
    suggestion = await suggestSeoMeta({
      resourceType: row.resourceType,
      resourceName: row.resourceName,
      currentSeoTitle: row.currentSeoTitle,
      currentSeoDescription: row.currentSeoDescription,
      resourceBodySummary: row.resourceBodySummary,
      issues: row.issues,
    });
    if (overrides?.meta_title) suggestion.meta_title = overrides.meta_title;
    if (overrides?.meta_description) {
      suggestion.meta_description = overrides.meta_description;
    }
  }

  if (!suggestion.meta_title || !suggestion.meta_description) {
    throw new Error('Missing meta_title or meta_description');
  }

  switch (row.resourceType) {
    case 'product':
      await updateProductSeo(
        admin,
        row.shopifyGid,
        suggestion.meta_title,
        suggestion.meta_description,
      );
      break;
    case 'collection':
      await updateCollectionSeo(
        admin,
        row.shopifyGid,
        suggestion.meta_title,
        suggestion.meta_description,
      );
      break;
    case 'page':
    case 'blog_article':
      await updatePageOrArticleSeoViaMetafields(
        admin,
        row.shopifyGid,
        suggestion.meta_title,
        suggestion.meta_description,
      );
      break;
    default:
      throw new Error(`Unsupported resource type: ${row.resourceType}`);
  }

  return prisma.seoScanResult.update({
    where: {id: row.id},
    data: {
      status: 'optimized',
      optimizedSeoTitle: suggestion.meta_title,
      optimizedSeoDescription: suggestion.meta_description,
      currentSeoTitle: suggestion.meta_title,
      currentSeoDescription: suggestion.meta_description,
      issues: [],
      lastOptimizedAt: new Date(),
    },
  });
}

async function applyImageOptimize(
  admin: AdminGraphqlClient,
  row: {
    id: string;
    shopifyGid: string;
    resourceType: string;
    resourceName: string | null;
    imageGid: string | null;
    currentImageAlt: string | null;
  },
  overrides?: Partial<SeoSuggestion>,
) {
  const altText = (
    overrides?.alt_text?.trim() ||
    (await suggestImageAlt({
      resourceName: row.resourceName,
      currentImageAlt: row.currentImageAlt,
    }))
  )
    .trim()
    .slice(0, 125);

  if (row.resourceType === 'product_image') {
    const imageGid = row.imageGid || row.shopifyGid;
    await updateProductImageAlt(admin, imageGid, altText);
  } else {
    await updateCollectionImageAlt(admin, row.shopifyGid, altText);
  }

  return prisma.seoScanResult.update({
    where: {id: row.id},
    data: {
      status: 'optimized',
      optimizedImageAlt: altText,
      currentImageAlt: altText,
      issues: [],
      lastOptimizedAt: new Date(),
    },
  });
}

async function applyHandleOptimize(
  admin: AdminGraphqlClient,
  row: {
    id: string;
    shopifyGid: string;
    resourceType: string;
    resourceName: string | null;
    currentHandle: string | null;
  },
  overrides?: Partial<SeoSuggestion>,
) {
  const newHandle =
    overrides?.handle?.trim() ||
    (await suggestHandle({
      resourceName: row.resourceName,
      currentHandle: row.currentHandle,
      resourceType: row.resourceType,
    }));

  const realGid = row.shopifyGid.replace(/::handle$/, '');

  switch (row.resourceType) {
    case 'product_handle':
      await updateProductHandle(admin, realGid, newHandle);
      break;
    case 'collection_handle':
      await updateCollectionHandle(admin, realGid, newHandle);
      break;
    case 'page_handle':
      await updatePageHandle(admin, realGid, newHandle);
      break;
    default:
      throw new Error(`Unsupported handle type: ${row.resourceType}`);
  }

  return prisma.seoScanResult.update({
    where: {id: row.id},
    data: {
      status: 'optimized',
      optimizedHandle: newHandle,
      currentHandle: newHandle,
      resourceHandle: newHandle,
      resourceUrl: buildUrlFromHandleType(row.resourceType, newHandle),
      issues: [],
      lastOptimizedAt: new Date(),
    },
  });
}

async function applyHeadingOptimize(
  admin: AdminGraphqlClient,
  row: {
    id: string;
    shopifyGid: string;
    resourceType: string;
    resourceName: string | null;
    currentSeoTitle: string | null;
    issues: unknown;
  },
  overrides?: Partial<SeoSuggestion>,
) {
  let h1Text: string;
  let h2Text: string | undefined;

  if (overrides?.h1?.trim()) {
    h1Text = overrides.h1.trim();
    h2Text = overrides.h2?.trim() || undefined;
  } else {
    const generated = await suggestHeadings({
      resourceName: row.resourceName,
      currentSeoTitle: row.currentSeoTitle,
      issues: row.issues,
    });
    h1Text = generated.h1;
    h2Text = generated.h2;
  }

  if (!h1Text) throw new Error('H1 text is blank after generation');

  const realGid = row.shopifyGid.replace(/::heading$/, '');

  switch (row.resourceType) {
    case 'product_heading': {
      const bodyHtml = await getProductBodyHtml(admin, realGid);
      const newHtml = fixHeadings(bodyHtml, h1Text, h2Text);
      await updateProductDescriptionHtml(admin, realGid, newHtml);
      break;
    }
    case 'page_heading': {
      const bodyHtml = await getPageBodyHtml(admin, realGid);
      const newHtml = fixHeadings(bodyHtml, h1Text, h2Text);
      await updatePageBodyHtml(admin, realGid, newHtml);
      break;
    }
    case 'blog_article_heading': {
      const fetched = await getArticleBodyHtml(admin, realGid);
      if (!fetched.blog_id) {
        throw new Error('Could not fetch blog ID for article');
      }
      const newHtml = fixHeadings(fetched.body, h1Text, h2Text);
      await updateArticleBodyHtml(admin, realGid, newHtml);
      break;
    }
    default:
      throw new Error(`Unsupported heading type: ${row.resourceType}`);
  }

  return prisma.seoScanResult.update({
    where: {id: row.id},
    data: {
      status: 'optimized',
      optimizedSeoTitle: h1Text,
      currentSeoTitle: h1Text,
      issues: [],
      lastOptimizedAt: new Date(),
    },
  });
}

export async function applyOptimize(
  admin: AdminGraphqlClient,
  shop: string,
  id: string,
  overrides?: Partial<SeoSuggestion>,
): Promise<SerializedSeoResult> {
  const hasOverride =
    Boolean(overrides?.meta_title) ||
    Boolean(overrides?.alt_text) ||
    Boolean(overrides?.handle) ||
    Boolean(overrides?.h1);

  if (!process.env.GROQ_API_KEY?.trim() && !hasOverride) {
    throw new Error('GROQ_API_KEY is not set');
  }

  const domain = normalizeShop(shop);
  const row = await prisma.seoScanResult.findFirst({
    where: {id, shop: domain},
  });
  if (!row) throw new Error('Item not found');

  if (row.status === 'optimized') {
    return serializeSeoResult(row);
  }

  try {
    let updated;
    if (IMAGE_TYPES.has(row.resourceType)) {
      updated = await applyImageOptimize(admin, row, overrides);
    } else if (HANDLE_TYPES.has(row.resourceType)) {
      updated = await applyHandleOptimize(admin, row, overrides);
    } else if (HEADING_TYPES.has(row.resourceType)) {
      updated = await applyHeadingOptimize(admin, row, overrides);
    } else {
      updated = await applySeoMetaOptimize(admin, row, overrides);
    }
    return serializeSeoResult(updated);
  } catch (error) {
    await prisma.seoScanResult
      .update({
        where: {id: row.id},
        data: {status: 'needs_fix'},
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function bulkOptimize(
  admin: AdminGraphqlClient,
  shop: string,
  ids: string[],
): Promise<{
  optimized: string[];
  failed: string[];
  errors: Record<string, string>;
}> {
  const optimized: string[] = [];
  const failed: string[] = [];
  const errors: Record<string, string> = {};

  for (const id of ids) {
    try {
      const row = await prisma.seoScanResult.findFirst({
        where: {id, shop: normalizeShop(shop)},
      });
      if (!row) {
        failed.push(id);
        errors[id] = 'Item not found';
        continue;
      }
      if (row.status === 'optimized') continue;
      await applyOptimize(admin, shop, id);
      optimized.push(id);
    } catch (error) {
      failed.push(id);
      errors[id] =
        error instanceof Error ? error.message : 'Optimize failed';
    }
  }

  return {optimized, failed, errors};
}

/** Alias used by routes that want preview from the optimize module. */
export {previewOptimize} from './seo-scan.server';
