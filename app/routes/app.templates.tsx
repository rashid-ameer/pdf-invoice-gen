/**
 * Templates overview (Screen 1): four document-type cards + large preview.
 * Gallery / create / select / delete live on `/app/templates/:type/change`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRouteError,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { TemplatePreview } from "../components/template-list-card";
import { APP_LOCALE } from "../constants/app";
import {
  getTemplatesForShop,
  type TemplateListItem,
} from "../models/template.server";
import { scheduleTemplateThumbnailRefresh } from "../models/template-thumbnail.server";
import { authenticate } from "../shopify.server";
import type { DocumentType } from "../types/index";
import {
  TEMPLATE_DOC_TYPES,
  documentTypeToSlug,
  parseTemplateTypeParam,
  templatesChangeHref,
} from "../utils/template-type-slug";

/** Narrower card list; large preview gets the rest. */
const OVERVIEW_COLUMNS =
  "@container (inline-size > 768px) 36% 64%, 1fr";

/** Thumbnail + details inside the card body. */
const TYPE_CARD_BODY_COLUMNS =
  "@container (inline-size > 400px) 72px 1fr, 1fr";

function isTemplatesOverviewPath(pathname: string): boolean {
  return /^\/app\/templates\/?$/.test(pathname);
}

function formatUpdatedAt(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(APP_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function selectedForType(
  items: TemplateListItem[],
): TemplateListItem | null {
  return items.find((item) => item.isDefault) ?? null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const selectedType =
    parseTemplateTypeParam(url.searchParams.get("type")) ?? "tax_invoice";

  const lists = await Promise.all(
    TEMPLATE_DOC_TYPES.map(async (doc) => {
      const list = await getTemplatesForShop(session.shop, doc.value);
      if (!list) return null;
      return {
        documentType: doc.value,
        selected: selectedForType(list.items),
      };
    }),
  );

  if (lists.some((entry) => entry == null)) {
    throw new Response("Store not found. Please reinstall the app.", {
      status: 404,
    });
  }

  const types = lists as Array<{
    documentType: DocumentType;
    selected: TemplateListItem | null;
  }>;

  for (const entry of types) {
    if (!entry.selected) continue;
    if (
      !entry.selected.thumbnailDataUrl ||
      entry.selected.tags.includes("Liquid")
    ) {
      scheduleTemplateThumbnailRefresh(session.shop, entry.selected.id);
    }
  }

  return { selectedType, types };
};

/** All four types are already in the loader — switching ?type= is UI-only. */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (
    isTemplatesOverviewPath(currentUrl.pathname) &&
    isTemplatesOverviewPath(nextUrl.pathname) &&
    currentUrl.searchParams.get("type") !== nextUrl.searchParams.get("type")
  ) {
    return false;
  }
  return defaultShouldRevalidate;
}

export default function TemplatesOverviewPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);

  // Full-page spinner only when arriving from another route — not when
  // switching the selected type (query-only) on this page.
  const loading =
    navigation.state === "loading" &&
    navigation.location != null &&
    isTemplatesOverviewPath(navigation.location.pathname) &&
    !isTemplatesOverviewPath(location.pathname);

  const selectedType =
    parseTemplateTypeParam(searchParams.get("type")) ?? "tax_invoice";
  const selectedEntry = useMemo(
    () =>
      data.types.find((entry) => entry.documentType === selectedType) ??
      data.types[0],
    [data.types, selectedType],
  );
  const selectedTemplate = selectedEntry?.selected ?? null;

  const selectType = useCallback(
    (type: DocumentType) => {
      if (type === selectedType) return;
      setPreviewError(null);
      const next = new URLSearchParams(searchParams);
      if (type === "tax_invoice") next.delete("type");
      else next.set("type", documentTypeToSlug(type));
      setSearchParams(next, { replace: true, preventScrollReset: true });
    },
    [searchParams, selectedType, setSearchParams],
  );

  useEffect(() => {
    setPreviewError(null);
  }, [selectedTemplate?.id, selectedTemplate?.thumbnailUrl]);

  return (
    <s-page heading="Templates" inlineSize="large">
      {loading ? (
        <s-stack alignItems="center" gap="base" padding="large">
          <s-spinner
            accessibilityLabel="Loading templates"
            size="large"
          />
          <s-text>Loading templates...</s-text>
        </s-stack>
      ) : (
        <s-stack gap="base">
          <s-text color="subdued">
            Manage the template used for each document type. Each type has its
            own template, settings, and actions.
          </s-text>

          <s-section padding="base">
            <s-query-container>
              <s-grid gridTemplateColumns={OVERVIEW_COLUMNS} gap="large-200">
                <s-stack gap="base">
                  {TEMPLATE_DOC_TYPES.map((doc) => {
                    const entry = data.types.find(
                      (t) => t.documentType === doc.value,
                    );
                    return (
                      <DocumentTypeCard
                        key={doc.value}
                        label={doc.label}
                        description={doc.description}
                        template={entry?.selected ?? null}
                        selected={selectedType === doc.value}
                        onSelect={() => selectType(doc.value)}
                        onEdit={() => {
                          if (!entry?.selected) return;
                          navigate(
                            `/app/templates/${encodeURIComponent(entry.selected.id)}`,
                          );
                        }}
                        onChange={() =>
                          navigate(templatesChangeHref(doc.value))
                        }
                      />
                    );
                  })}
                </s-stack>

                <s-box
                  padding="base"
                  background="base"
                  border="base"
                  borderRadius="base"
                >
                  <s-stack gap="base">
                    {previewError ? (
                      <s-banner tone="critical" heading="Preview unavailable">
                        <s-stack gap="base">
                          <s-text>{previewError}</s-text>
                          <s-button
                            variant="secondary"
                            onClick={() => {
                              setPreviewError(null);
                              setPreviewRetry((n) => n + 1);
                            }}
                          >
                            Try again
                          </s-button>
                        </s-stack>
                      </s-banner>
                    ) : null}

                    {!selectedTemplate ? (
                      <s-text color="subdued">
                        Choose a template to see a preview
                      </s-text>
                    ) : previewError ? null : (
                      <OverviewTemplatePreview
                        key={`${selectedTemplate.id}-${previewRetry}`}
                        template={selectedTemplate}
                        onError={setPreviewError}
                      />
                    )}
                  </s-stack>
                </s-box>
              </s-grid>
            </s-query-container>
          </s-section>
        </s-stack>
      )}
    </s-page>
  );
}

function DocumentTypeCard({
  label,
  description,
  template,
  selected,
  onSelect,
  onEdit,
  onChange,
}: {
  label: string;
  description: string;
  template: TemplateListItem | null;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onChange: () => void;
}) {
  const updatedLabel = formatUpdatedAt(template?.updatedAt);
  const hasTemplate = template != null;

  const selectLabel = `${label}${selected ? ", selected" : ""}${
    hasTemplate ? `, ${template.name}` : ", no template selected"
  }`;

  return (
    <s-box
      padding="base"
      background={selected ? "subdued" : "base"}
      border={selected ? "large strong" : "base"}
      borderRadius="base"
    >
      <s-stack gap="base">
        {/* Selection target only — buttons stay outside so they never select. */}
        <s-clickable
          onClick={onSelect}
          accessibilityLabel={selectLabel}
          borderRadius="base"
          inlineSize="fill"
        >
          <s-grid
            gridTemplateColumns="1fr auto"
            gap="base"
            alignItems="start"
          >
            <s-query-container>
              {hasTemplate ? (
                <s-grid
                  gridTemplateColumns={TYPE_CARD_BODY_COLUMNS}
                  gap="base"
                  alignItems="start"
                >
                  <TemplatePreview
                    dataUrl={template.thumbnailDataUrl}
                    fetchUrl={template.thumbnailUrl}
                    name={template.name}
                    objectFit="contain"
                  />
                  <s-stack gap="small-200">
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-text type="strong">{label}</s-text>
                      <s-badge tone="success">Default</s-badge>
                    </s-stack>
                    <s-text color="subdued">{description}</s-text>
                    <s-stack gap="none">
                      <s-text type="strong">
                        Current template: {template.name}
                      </s-text>
                      {updatedLabel ? (
                        <s-text color="subdued">
                          Last updated {updatedLabel}
                        </s-text>
                      ) : null}
                    </s-stack>
                  </s-stack>
                </s-grid>
              ) : (
                <s-stack gap="small-200">
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-text type="strong">{label}</s-text>
                    <s-badge tone="success">Default</s-badge>
                  </s-stack>
                  <s-text color="subdued">{description}</s-text>
                  <s-text color="subdued">No template selected</s-text>
                </s-stack>
              )}
            </s-query-container>

            <s-icon
              type={selected ? "check-circle" : "circle"}
              tone={selected ? "info" : "neutral"}
              color={selected ? "base" : "subdued"}
            />
          </s-grid>
        </s-clickable>

        <s-stack direction="inline" gap="small-200">
          {hasTemplate ? (
            <s-button variant="secondary" onClick={onEdit}>
              Edit template
            </s-button>
          ) : null}
          <s-button variant="secondary" onClick={onChange}>
            Change template
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

/**
 * Large overview preview: same thumbnail source as the gallery, with contain
 * fit and an error path for Try again.
 */
function OverviewTemplatePreview({
  template,
  onError,
}: {
  template: TemplateListItem;
  onError: (message: string | null) => void;
}) {
  const shopify = useAppBridge();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!template.thumbnailDataUrl);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (template.thumbnailDataUrl) {
      setObjectUrl(null);
      setLoading(false);
      onErrorRef.current(null);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setLoading(true);

    (async () => {
      try {
        const token = await shopify.idToken();
        const res = await fetch(template.thumbnailUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) {
            setLoading(false);
            onErrorRef.current("Couldn't load template preview.");
          }
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
        setLoading(false);
        onErrorRef.current(null);
      } catch {
        if (!cancelled) {
          setLoading(false);
          onErrorRef.current("Couldn't load template preview.");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [template.thumbnailDataUrl, template.thumbnailUrl, shopify]);

  if (loading) {
    return (
      <s-stack alignItems="center" gap="base" padding="large">
        <s-spinner accessibilityLabel="Loading preview" size="large" />
        <s-text color="subdued">Loading preview...</s-text>
      </s-stack>
    );
  }

  const src = template.thumbnailDataUrl || objectUrl || undefined;
  if (!src) return null;

  return (
    <s-image
      src={src}
      alt={`${template.name} preview`}
      aspectRatio="3/4"
      objectFit="contain"
      inlineSize="fill"
      border="base"
      borderRadius="base"
      loading="eager"
    />
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
