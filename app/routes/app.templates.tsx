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
  getSelectedTemplatesByTypeForShop,
  type TemplateListItem,
} from "../models/template.server";
import { scheduleTemplateThumbnailRefresh } from "../models/template-thumbnail.server";
import { authenticate } from "../shopify.server";
import type { DocumentType } from "../types/index";
import {
  TEMPLATE_DOC_TYPES,
  parseTemplateTypeParam,
  templatesChangeHref,
  templatesOverviewHref,
} from "../utils/template-type-slug";

/** Narrower card list; large preview gets the rest. */
/** Always side-by-side: type cards | preview (never stacks). */
const OVERVIEW_COLUMNS = "minmax(0, 36%) minmax(0, 64%)";

/** Always horizontal inside each type card: thumbnail | details. */
const TYPE_CARD_BODY_COLUMNS = "72px minmax(0, 1fr)";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const selectedType =
    parseTemplateTypeParam(url.searchParams.get("type")) ?? "tax_invoice";

  const types = await getSelectedTemplatesByTypeForShop(
    session.shop,
    TEMPLATE_DOC_TYPES.map((doc) => doc.value),
  );
  if (!types) {
    throw new Response("Store not found. Please reinstall the app.", {
      status: 404,
    });
  }

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
  const [searchParams] = useSearchParams();
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  // Full-page spinner only when arriving from another route — not when
  // switching the selected type (query-only) on this page.
  const loading =
    navigation.state === "loading" &&
    navigation.location != null &&
    isTemplatesOverviewPath(navigation.location.pathname) &&
    !isTemplatesOverviewPath(location.pathname);

  useEffect(() => {
    if (navigation.state === "idle") setPendingNav(null);
  }, [navigation.state]);

  const urlSelectedType =
    parseTemplateTypeParam(searchParams.get("type")) ?? "tax_invoice";
  // Local state so preview updates immediately on card click (URL sync is secondary).
  const [selectedType, setSelectedType] =
    useState<DocumentType>(urlSelectedType);

  useEffect(() => {
    setSelectedType(urlSelectedType);
  }, [urlSelectedType]);

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
      setSelectedType(type);
      navigate(templatesOverviewHref(type), {
        replace: true,
        preventScrollReset: true,
      });
    },
    [navigate, selectedType],
  );

  useEffect(() => {
    setPreviewError(null);
  }, [selectedTemplate?.id, selectedTemplate?.thumbnailUrl]);

  return (
    <s-page heading="Templates" inlineSize="base">
      {loading ? (
        <s-stack alignItems="center" gap="base" padding="large">
          <s-spinner
            accessibilityLabel="Loading templates"
            size="large"
          />
          <s-text>Loading templates...</s-text>
        </s-stack>
      ) : (
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
                      documentType={doc.value}
                      label={doc.label}
                      template={entry?.selected ?? null}
                      selected={selectedType === doc.value}
                      onSelect={selectType}
                    />
                  );
                })}
              </s-stack>

              <s-stack gap="base">
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-heading>Preview</s-heading>
                  <s-stack direction="inline" gap="small-200">
                    {selectedTemplate ? (
                      <s-button
                        variant="secondary"
                        onClick={() => {
                          setPendingNav(`edit:${selectedType}`);
                          navigate(
                            `/app/templates/${encodeURIComponent(selectedTemplate.id)}`,
                          );
                        }}
                        {...(pendingNav === `edit:${selectedType}` &&
                        navigation.state !== "idle"
                          ? { loading: true }
                          : {})}
                      >
                        Edit template
                      </s-button>
                    ) : null}
                    <s-button
                      variant="secondary"
                      onClick={() => {
                        setPendingNav(`change:${selectedType}`);
                        navigate(templatesChangeHref(selectedType));
                      }}
                      {...(pendingNav === `change:${selectedType}` &&
                      navigation.state !== "idle"
                        ? { loading: true }
                        : {})}
                    >
                      Change template
                    </s-button>
                  </s-stack>
                </s-stack>

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
            </s-grid>
          </s-query-container>
        </s-section>
      )}
    </s-page>
  );
}

function DocumentTypeCard({
  documentType,
  label,
  template,
  selected,
  onSelect,
}: {
  documentType: DocumentType;
  label: string;
  template: TemplateListItem | null;
  selected: boolean;
  onSelect: (type: DocumentType) => void;
}) {
  const updatedLabel = formatUpdatedAt(template?.updatedAt);
  const hasTemplate = template != null;
  const clickableRef = useRef<HTMLElement | null>(null);

  // Polaris web components emit native `click`; bind via DOM for reliable card hits.
  useEffect(() => {
    const el = clickableRef.current;
    if (!el) return;
    const handleClick = () => {
      onSelect(documentType);
    };
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [documentType, onSelect]);

  const selectLabel = `${label}${selected ? ", selected" : ""}${
    hasTemplate ? `, ${template.name}` : ", no template selected"
  }`;

  return (
    <s-clickable
      ref={clickableRef as never}
      accessibilityLabel={selectLabel}
      padding="base"
      background={selected ? "subdued" : "base"}
      border={selected ? "large strong" : "base"}
      borderRadius="base"
    >
      <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="start">
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
                  <s-text type="strong" fontWeight="semibold" fontSize="base">{label}</s-text>
                  <s-badge tone="success">Default</s-badge>
                </s-stack>
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
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">{label}</s-text>
                <s-badge tone="success">Default</s-badge>
              </s-stack>
              <s-text color="subdued">No template selected</s-text>
            </s-stack>
          )}
        </s-query-container>

        {selected ? <s-icon type="check-circle" tone="success" /> : null}
      </s-grid>
    </s-clickable>
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
