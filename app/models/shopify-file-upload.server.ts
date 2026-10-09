type AdminClient = {
  graphql: (
    query: string,
    options?: {variables?: Record<string, unknown>},
  ) => Promise<Response>;
};

function sanitizeFilename(name: string) {
  const basename = name.split(/[/\\]/).pop() || 'brand-logo.png';
  return basename.replace(/[^\w.\-]+/g, '-') || 'brand-logo.png';
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphqlJson(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
) {
  const response = await admin.graphql(query, variables ? {variables} : undefined);
  return response.json() as Promise<{data?: Record<string, unknown>; errors?: Array<{message?: string}>}>;
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstErrorMessage(value: unknown) {
  const errors = asRecord(value).userErrors;
  if (!Array.isArray(errors) || !errors[0]) return '';
  const message = asRecord(errors[0]).message;
  return typeof message === 'string' ? message : '';
}

function fileUrlFromNode(node: {
  fileStatus?: string;
  url?: string;
  image?: {url?: string} | null;
  preview?: {image?: {url?: string} | null} | null;
} | null) {
  if (!node) return '';
  return (
    node.image?.url ||
    node.preview?.image?.url ||
    node.url ||
    ''
  ).trim();
}

async function waitForFileUrl(admin: AdminClient, fileId: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const json = await graphqlJson(
      admin,
      `#graphql
        query EmailLogoFile($id: ID!) {
          node(id: $id) {
            ... on MediaImage {
              fileStatus
              image { url }
            }
            ... on GenericFile {
              fileStatus
              url
            }
          }
        }
      `,
      {id: fileId},
    );

    const node = asRecord(asRecord(json.data).node);
    const url = fileUrlFromNode({
      fileStatus: typeof node.fileStatus === 'string' ? node.fileStatus : undefined,
      url: typeof node.url === 'string' ? node.url : undefined,
      image: asRecord(node.image) as {url?: string},
    });
    if (url) return url;
    if (node.fileStatus === 'FAILED') {
      throw new Error('Shopify could not process the logo image.');
    }
    await wait(400);
  }

  throw new Error('Logo uploaded, but Shopify did not return an image URL yet. Try again in a moment.');
}

/** Upload an image to Shopify Files and return a public CDN URL for emails. */
export async function uploadShopifyImageFile(
  admin: AdminClient,
  image: File,
  alt = 'Brand logo',
) {
  if (image.size === 0) {
    throw new Error('Logo file is empty.');
  }

  const filename = sanitizeFilename(image.name);
  const mimeType = image.type || 'image/png';

  const stagedJson = await graphqlJson(
    admin,
    `#graphql
      mutation StageEmailLogo($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      input: [
        {
          filename,
          mimeType,
          resource: 'FILE',
          httpMethod: 'POST',
        },
      ],
    },
  );

  const staged = asRecord(asRecord(stagedJson.data).stagedUploadsCreate);
  const stagedError = firstErrorMessage(staged);
  const targets = Array.isArray(staged.stagedTargets) ? staged.stagedTargets : [];
  const target = asRecord(targets[0]);
  const targetUrl = typeof target.url === 'string' ? target.url : '';
  const resourceUrl =
    typeof target.resourceUrl === 'string' ? target.resourceUrl : '';
  const parameters = Array.isArray(target.parameters) ? target.parameters : [];

  if (stagedError || !targetUrl || !resourceUrl) {
    throw new Error(stagedError || 'Could not start logo upload.');
  }

  const body = new FormData();
  for (const parameter of parameters) {
    const item = asRecord(parameter);
    if (typeof item.name === 'string' && typeof item.value === 'string') {
      body.append(item.name, item.value);
    }
  }
  body.append('file', image, filename);

  const upload = await fetch(targetUrl, {method: 'POST', body});
  if (!upload.ok) {
    throw new Error('Could not upload the logo file.');
  }

  const createdJson = await graphqlJson(
    admin,
    `#graphql
      mutation CreateEmailLogo($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            ... on MediaImage {
              image { url }
            }
            ... on GenericFile {
              url
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      files: [
        {
          alt,
          contentType: 'IMAGE',
          originalSource: resourceUrl,
        },
      ],
    },
  );

  const created = asRecord(asRecord(createdJson.data).fileCreate);
  const createError = firstErrorMessage(created);
  const files = Array.isArray(created.files) ? created.files : [];
  const file = asRecord(files[0]);
  const fileId = typeof file.id === 'string' ? file.id : '';

  if (createError || !fileId) {
    throw new Error(createError || 'Could not save the logo in Shopify Files.');
  }

  const immediateUrl = fileUrlFromNode({
    fileStatus: typeof file.fileStatus === 'string' ? file.fileStatus : undefined,
    url: typeof file.url === 'string' ? file.url : undefined,
    image: asRecord(file.image) as {url?: string},
  });
  if (immediateUrl) return immediateUrl;
  return waitForFileUrl(admin, fileId);
}
