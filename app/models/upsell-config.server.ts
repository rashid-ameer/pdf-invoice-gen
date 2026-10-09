import {
  defaultUpsellConfig,
  normalizeUpsellConfig,
  type UpsellConfig,
} from './upsell-config';

export {
  defaultUpsellConfig,
  normalizeUpsellConfig,
  type UpsellConfig,
} from './upsell-config';

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {variables?: Record<string, unknown>},
  ) => Promise<Response>;
};

const UPSELL_NAMESPACE = 'upsell_app';
const UPSELL_KEY = 'config';

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

export async function getShopId(admin: AdminGraphqlClient): Promise<string> {
  const data = await graphqlJson<{shop: {id: string}}>(
    admin,
    `#graphql
      query UpsellGetShopId {
        shop { id }
      }
    `,
  );
  return data.shop.id;
}

export async function getUpsellConfig(
  admin: AdminGraphqlClient,
): Promise<UpsellConfig> {
  const data = await graphqlJson<{
    shop: {metafield: {value: string} | null};
  }>(
    admin,
    `#graphql
      query UpsellGetConfig {
        shop {
          metafield(namespace: "${UPSELL_NAMESPACE}", key: "${UPSELL_KEY}") {
            value
          }
        }
      }
    `,
  );

  const raw = data.shop.metafield?.value;
  if (!raw) return defaultUpsellConfig();
  try {
    return normalizeUpsellConfig(JSON.parse(raw));
  } catch {
    return defaultUpsellConfig();
  }
}

export async function ensureUpsellMetafieldVisibility(
  admin: AdminGraphqlClient,
): Promise<void> {
  const existing = await graphqlJson<{
    metafieldDefinitions: {
      nodes: Array<{id: string; access: {storefront: string | null}}>;
    };
  }>(
    admin,
    `#graphql
      query UpsellConfigStorefrontVisibility {
        metafieldDefinitions(
          first: 1
          namespace: "${UPSELL_NAMESPACE}"
          key: "${UPSELL_KEY}"
          ownerType: SHOP
        ) {
          nodes {
            id
            access { storefront }
          }
        }
      }
    `,
  );

  const node = existing.metafieldDefinitions.nodes[0];
  if (node?.access?.storefront === 'PUBLIC_READ') return;

  if (node) {
    const updated = await graphqlJson<{
      metafieldDefinitionUpdate: {
        userErrors: Array<{field?: string[]; message: string}>;
      };
    }>(
      admin,
      `#graphql
        mutation UpsellMetafieldDefinitionUpdate(
          $definition: MetafieldDefinitionUpdateInput!
        ) {
          metafieldDefinitionUpdate(definition: $definition) {
            updatedDefinition { id access { storefront } }
            userErrors { field message }
          }
        }
      `,
      {
        definition: {
          namespace: UPSELL_NAMESPACE,
          key: UPSELL_KEY,
          ownerType: 'SHOP',
          access: {storefront: 'PUBLIC_READ'},
        },
      },
    );
    const errors = updated.metafieldDefinitionUpdate.userErrors;
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).join('; '));
    }
    return;
  }

  const created = await graphqlJson<{
    metafieldDefinitionCreate: {
      userErrors: Array<{
        field?: string[];
        message: string;
        code?: string;
      }>;
    };
  }>(
    admin,
    `#graphql
      mutation UpsellMetafieldDefinitionCreate(
        $definition: MetafieldDefinitionInput!
      ) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id access { storefront } }
          userErrors { field message code }
        }
      }
    `,
    {
      definition: {
        name: 'Upsell App Config',
        namespace: UPSELL_NAMESPACE,
        key: UPSELL_KEY,
        type: 'json',
        ownerType: 'SHOP',
        access: {storefront: 'PUBLIC_READ'},
      },
    },
  );

  const errors = created.metafieldDefinitionCreate.userErrors;
  const alreadyExists = errors.some(
    (e) =>
      /TAKEN|ALREADY|EXISTS/i.test(String(e.code || '')) ||
      /taken|already|exists/i.test(e.message),
  );
  if (alreadyExists) {
    const updated = await graphqlJson<{
      metafieldDefinitionUpdate: {
        userErrors: Array<{field?: string[]; message: string}>;
      };
    }>(
      admin,
      `#graphql
        mutation UpsellMetafieldDefinitionUpdateAfterCreate(
          $definition: MetafieldDefinitionUpdateInput!
        ) {
          metafieldDefinitionUpdate(definition: $definition) {
            updatedDefinition { id access { storefront } }
            userErrors { field message }
          }
        }
      `,
      {
        definition: {
          namespace: UPSELL_NAMESPACE,
          key: UPSELL_KEY,
          ownerType: 'SHOP',
          access: {storefront: 'PUBLIC_READ'},
        },
      },
    );
    const updateErrors = updated.metafieldDefinitionUpdate.userErrors;
    if (updateErrors.length) {
      throw new Error(updateErrors.map((e) => e.message).join('; '));
    }
    return;
  }
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
}

export async function saveUpsellConfig(
  admin: AdminGraphqlClient,
  config: UpsellConfig,
): Promise<UpsellConfig> {
  const normalized = normalizeUpsellConfig(config);
  await ensureUpsellMetafieldVisibility(admin);
  const shopId = await getShopId(admin);

  const result = await graphqlJson<{
    metafieldsSet: {
      userErrors: Array<{field?: string[]; message: string}>;
    };
  }>(
    admin,
    `#graphql
      mutation UpsellMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key }
          userErrors { field message }
        }
      }
    `,
    {
      metafields: [
        {
          ownerId: shopId,
          namespace: UPSELL_NAMESPACE,
          key: UPSELL_KEY,
          type: 'json',
          value: JSON.stringify(normalized),
        },
      ],
    },
  );

  const errors = result.metafieldsSet.userErrors;
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
  return normalized;
}
