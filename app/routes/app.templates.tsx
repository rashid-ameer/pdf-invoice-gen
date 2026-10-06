import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRouteError,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import type { DocumentType } from "../types/index";
import {
  createCustomTemplate,
  deleteCustomTemplate,
  getTemplatesForShop,
  parseBaseLayoutCode,
  parseDocumentType,
  setDefaultTemplate,
  type TemplateListItem,
} from "../models/template.server";
import { scheduleTemplateThumbnailRefresh } from "../models/template-thumbnail.server";
import { authenticate } from "../shopify.server";

const DOC_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: "tax_invoice", label: "Tax invoices" },
  { value: "credit_note", label: "Credit notes" },
  { value: "refund_document", label: "Refund documents" },
  { value: "packing_slip", label: "Packing slips" },
];

function documentTypeLabel(type: DocumentType): string {
  return DOC_TYPES.find((t) => t.value === type)?.label ?? type;
}

function isTemplatesListPath(pathname: string): boolean {
  return /^\/app\/templates\/?$/.test(pathname);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const documentType = parseDocumentType(url.searchParams.get("type"));

  const list = await getTemplatesForShop(session.shop, documentType);
  if (!list) {
    throw new Response("Store not found. Please reinstall the app.", {
      status: 404,
    });
  }

  // Kick off JPEG generation for templates that still lack a cached thumbnail
  // (old lazy-on-img-request parity). Concurrent limit lives in the thumbnail service.
  for (const item of [...list.customItems, ...list.systemItems]) {
    if (!item.thumbnailDataUrl) {
      scheduleTemplateThumbnailRefresh(session.shop, item.id);
    }
  }

  return {
    documentType,
    customItems: list.customItems,
    systemItems: list.systemItems,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create-layout") {
    const baseLayoutCode = parseBaseLayoutCode(formData.get("baseLayoutCode"));
    if (!baseLayoutCode) {
      return {
        ok: false as const,
        intent: "create-layout" as const,
        error: "Invalid base layout",
      };
    }
    const documentType = parseDocumentType(formData.get("documentType"));
    const sourceTemplateId = String(
      formData.get("sourceTemplateId") ?? "",
    ).trim();
    const created = await createCustomTemplate(session.shop, {
      name: "",
      baseLayoutCode,
      documentType,
      sourceTemplateId: sourceTemplateId || undefined,
    });
    if (!created) {
      return {
        ok: false as const,
        intent: "create-layout" as const,
        error: "Store not found",
      };
    }
    scheduleTemplateThumbnailRefresh(session.shop, created.id);
    return {
      ok: true as const,
      intent: "create-layout" as const,
      templateId: created.id,
      documentType: created.documentType as DocumentType,
      message: "Template created",
    };
  }

  if (intent === "create-code") {
    const documentType = parseDocumentType(formData.get("documentType"));
    const created = await createCustomTemplate(session.shop, {
      name: "Untitled template",
      baseLayoutCode: "modern",
      documentType,
      sourceType: "code",
      liquidHtml: "",
    });
    if (!created) {
      return {
        ok: false as const,
        intent: "create-code" as const,
        error: "Store not found",
      };
    }
    scheduleTemplateThumbnailRefresh(session.shop, created.id);
    return {
      ok: true as const,
      intent: "create-code" as const,
      templateId: created.id,
      documentType: created.documentType as DocumentType,
      message: "Template created",
    };
  }

  if (intent === "set-default") {
    const templateId = String(formData.get("templateId") ?? "").trim();
    if (!templateId) {
      return {
        ok: false as const,
        intent: "set-default" as const,
        error: "Template not found",
      };
    }
    const updated = await setDefaultTemplate(session.shop, templateId);
    if (!updated) {
      return {
        ok: false as const,
        intent: "set-default" as const,
        error: "Template not found",
      };
    }
    return {
      ok: true as const,
      intent: "set-default" as const,
      message: `Default ${documentTypeLabel(parseDocumentType(updated.documentType)).toLowerCase().replace(/s$/, "")} template updated.`,
    };
  }

  if (intent === "delete") {
    const templateId = String(formData.get("templateId") ?? "").trim();
    if (!templateId) {
      return {
        ok: false as const,
        intent: "delete" as const,
        error: "Template not found or cannot be deleted",
      };
    }
    const deleted = await deleteCustomTemplate(session.shop, templateId);
    if (!deleted) {
      return {
        ok: false as const,
        intent: "delete" as const,
        error: "Template not found or cannot be deleted",
      };
    }
    return {
      ok: true as const,
      intent: "delete" as const,
      message: "Template deleted",
    };
  }

  return {
    ok: false as const,
    intent: "unknown" as const,
    error: "Unknown action",
  };
};

export default function TemplatesPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const [kindFilter, setKindFilter] = useState<"all" | "custom" | "system">(
    "all",
  );
  const [searchDraft, setSearchDraft] = useState("");
  const awaiting = useRef(false);
  const dataAtSubmit = useRef(fetcher.data);

  const loading =
    navigation.state === "loading" &&
    navigation.location != null &&
    isTemplatesListPath(navigation.location.pathname);
  const busy =
    fetcher.state === "submitting" || fetcher.state === "loading";

  useEffect(() => {
    if (!awaiting.current || fetcher.state !== "idle") return;
    awaiting.current = false;

    if (!fetcher.data || fetcher.data === dataAtSubmit.current) {
      shopify.toast.show("Couldn't update templates", { isError: true });
      return;
    }

    if (!fetcher.data.ok) {
      shopify.toast.show(
        ("error" in fetcher.data && fetcher.data.error) || "Request failed",
        { isError: true },
      );
      return;
    }

    if (
      (fetcher.data.intent === "create-layout" ||
        fetcher.data.intent === "create-code") &&
      "templateId" in fetcher.data &&
      fetcher.data.templateId
    ) {
      shopify.toast.show(fetcher.data.message);
      navigate(
        `/app/templates/${encodeURIComponent(fetcher.data.templateId)}?new=1`,
      );
      return;
    }

    shopify.toast.show(
      "message" in fetcher.data ? fetcher.data.message : "Done",
    );
  }, [fetcher.state, fetcher.data, navigate, shopify]);

  const switchType = useCallback(
    (type: DocumentType) => {
      const next = new URLSearchParams(searchParams);
      if (type === "tax_invoice") next.delete("type");
      else next.set("type", type);
      const qs = next.toString();
      navigate(qs ? `/app/templates?${qs}` : "/app/templates");
    },
    [navigate, searchParams],
  );

  const submitIntent = (
    intent: string,
    fields: Record<string, string>,
  ) => {
    if (busy) return;
    dataAtSubmit.current = fetcher.data;
    awaiting.current = true;
    const body = new FormData();
    body.set("intent", intent);
    for (const [key, value] of Object.entries(fields)) {
      body.set(key, value);
    }
    fetcher.submit(body, { method: "post" });
  };

  const matchesSearch = (item: TemplateListItem) => {
    const q = searchDraft.trim().toLowerCase();
    if (!q) return true;
    const haystack = `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
    return haystack.includes(q);
  };

  const customItems = useMemo(
    () => data.customItems.filter(matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.customItems, searchDraft],
  );
  const systemItems = useMemo(
    () => data.systemItems.filter(matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.systemItems, searchDraft],
  );

  const showCustom = kindFilter === "all" || kindFilter === "custom";
  const showSystem = kindFilter === "all" || kindFilter === "system";

  const typeSwitcher = (
    <s-button-group accessibilityLabel="Document type">
      {DOC_TYPES.map((type) => (
        <s-button
          key={type.value}
          slot="secondary-actions"
          variant="secondary"
          icon={data.documentType === type.value ? "check" : undefined}
          aria-pressed={data.documentType === type.value}
          onClick={() => switchType(type.value)}
        >
          {type.label}
        </s-button>
      ))}
    </s-button-group>
  );

  const renderRow = (item: TemplateListItem) => {
    const menuId = `template-actions-${item.id}`;
    return (
      <s-table-row key={item.id}>
        <s-table-cell>
          <s-stack direction="inline" gap="base" alignItems="center">
            <TemplateThumb
              dataUrl={item.thumbnailDataUrl}
              fetchUrl={item.thumbnailUrl}
              theme={item.theme}
              alt=""
              name={item.name}
            />
            <s-stack gap="none">
              <s-link href={`/app/templates/${encodeURIComponent(item.id)}`}>
                {item.name}
              </s-link>
              <s-text color="subdued">{item.description || item.code}</s-text>
            </s-stack>
          </s-stack>
        </s-table-cell>
        <s-table-cell>
          <s-badge>{item.isSystem ? "System" : "Custom"}</s-badge>
        </s-table-cell>
        <s-table-cell>
          {item.isDefault ? (
            <s-badge tone="success">Default</s-badge>
          ) : (
            <s-text color="subdued">—</s-text>
          )}
        </s-table-cell>
        <s-table-cell>
          <s-stack direction="inline" gap="small">
            {item.tags.map((tag) => (
              <s-badge key={`${item.id}-${tag}`}>{tag}</s-badge>
            ))}
          </s-stack>
        </s-table-cell>
        <s-table-cell>
          <s-button
            icon="menu-horizontal"
            variant="tertiary"
            accessibilityLabel={`More actions for ${item.name}`}
            commandFor={menuId}
          />
          <s-menu
            id={menuId}
            accessibilityLabel={`Actions for ${item.name}`}
          >
            <s-button
              icon={item.isSystem ? "duplicate" : "edit"}
              onClick={() =>
                navigate(`/app/templates/${encodeURIComponent(item.id)}`)
              }
            >
              {item.isSystem ? "Customize" : "Edit"}
            </s-button>
            {!item.isDefault ? (
              <s-button
                icon="check"
                onClick={() =>
                  submitIntent("set-default", { templateId: item.id })
                }
                {...(busy ? { disabled: true } : {})}
              >
                Set as default
              </s-button>
            ) : (
              <s-button icon="check" disabled>
                Applied
              </s-button>
            )}
            {item.isCustom && !item.isDefault ? (
              <s-button
                icon="delete"
                tone="critical"
                onClick={() => {
                  if (!window.confirm("Delete this template?")) return;
                  submitIntent("delete", { templateId: item.id });
                }}
                {...(busy ? { disabled: true } : {})}
              >
                Delete
              </s-button>
            ) : null}
          </s-menu>
        </s-table-cell>
      </s-table-row>
    );
  };

  return (
    <s-page heading="Templates" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() =>
          submitIntent("create-code", { documentType: data.documentType })
        }
        {...(busy ? { loading: true, disabled: true } : {})}
      >
        Create new template
      </s-button>

      <s-section padding="none" accessibilityLabel="Templates">
        <s-box padding="base">
          <s-stack gap="base">
            {typeSwitcher}
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-text-field
                label="Search"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search templates"
                value={searchDraft}
                onInput={(event: Event) => {
                  setSearchDraft(
                    (event.currentTarget as HTMLInputElement).value,
                  );
                }}
              />
              <s-button-group accessibilityLabel="Template kind">
                {(
                  [
                    ["all", "All"],
                    ["custom", "Custom"],
                    ["system", "System"],
                  ] as const
                ).map(([value, label]) => (
                  <s-button
                    key={value}
                    slot="secondary-actions"
                    variant="secondary"
                    icon={kindFilter === value ? "check" : undefined}
                    aria-pressed={kindFilter === value}
                    onClick={() => setKindFilter(value)}
                  >
                    {label}
                  </s-button>
                ))}
              </s-button-group>
            </s-stack>
          </s-stack>
        </s-box>

        {showCustom ? (
          <s-box padding="base">
            <s-stack gap="small">
              <s-heading>My templates</s-heading>
              {customItems.length === 0 ? (
                <s-text color="subdued">
                  No custom {documentTypeLabel(data.documentType).toLowerCase()}{" "}
                  templates yet. Customize a system template or create a new
                  one.
                </s-text>
              ) : (
                <s-table {...(loading ? { loading: true } : {})}>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Template</s-table-header>
                    <s-table-header listSlot="labeled">Kind</s-table-header>
                    <s-table-header listSlot="labeled">Default</s-table-header>
                    <s-table-header listSlot="labeled">Tags</s-table-header>
                    <s-table-header listSlot="labeled">Actions</s-table-header>
                  </s-table-header-row>
                  <s-table-body>{customItems.map(renderRow)}</s-table-body>
                </s-table>
              )}
            </s-stack>
          </s-box>
        ) : null}

        {showSystem ? (
          <s-box padding="base">
            <s-stack gap="small">
              <s-heading>System templates</s-heading>
              {systemItems.length === 0 ? (
                <s-text color="subdued">No system templates found.</s-text>
              ) : (
                <s-table {...(loading ? { loading: true } : {})}>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Template</s-table-header>
                    <s-table-header listSlot="labeled">Kind</s-table-header>
                    <s-table-header listSlot="labeled">Default</s-table-header>
                    <s-table-header listSlot="labeled">Tags</s-table-header>
                    <s-table-header listSlot="labeled">Actions</s-table-header>
                  </s-table-header-row>
                  <s-table-body>{systemItems.map(renderRow)}</s-table-body>
                </s-table>
              )}
            </s-stack>
          </s-box>
        ) : null}
      </s-section>
    </s-page>
  );
}

/**
 * List thumbnail: prefer cached data URL from the loader (no auth needed).
 * Fall back to a CSS mini-preview (old parity — never a blank box) and optionally
 * fetch JPEG with App Bridge Bearer when cache is still empty.
 */
function TemplateThumb({
  dataUrl,
  fetchUrl,
  theme,
  alt,
  name,
}: {
  dataUrl: string | null;
  fetchUrl: string;
  theme: { primary: string; accent: string; secondary: string };
  alt: string;
  name: string;
}) {
  const shopify = useAppBridge();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (dataUrl) {
      setObjectUrl(null);
      return;
    }

    let cancelled = false;
    let created: string | null = null;

    (async () => {
      try {
        const token = await shopify.idToken();
        const res = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        // Keep CSS mini-preview — never force a blank failed state.
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [dataUrl, fetchUrl, shopify]);

  const src = dataUrl || objectUrl;
  if (src) {
    return (
      <img
        src={src}
        alt={alt || `${name} preview`}
        loading="lazy"
        decoding="async"
        width={48}
        height={64}
        style={{
          width: 48,
          height: 64,
          objectFit: "cover",
          objectPosition: "top center",
          borderRadius: 4,
          border: "1px solid #c9cccf",
          background: "#f1f2f3",
          display: "block",
          flexShrink: 0,
        }}
      />
    );
  }

  return <MiniPreview theme={theme} name={name} />;
}

/** Compact CSS stub matching old list mini-preview (always visible). */
function MiniPreview({
  theme,
  name,
}: {
  theme: { primary: string; accent: string; secondary: string };
  name: string;
}) {
  return (
    <div
      aria-label={`${name} preview`}
      style={{
        width: 48,
        height: 64,
        borderRadius: 4,
        border: "1px solid #c9cccf",
        background: "#fff",
        overflow: "hidden",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      <div style={{ height: 10, background: theme.primary }} />
      <div style={{ padding: 5 }}>
        <div
          style={{
            height: 3,
            width: "72%",
            background: theme.accent,
            marginBottom: 4,
            borderRadius: 1,
          }}
        />
        <div
          style={{
            height: 2,
            width: "100%",
            background: "#e1e3e5",
            marginBottom: 3,
          }}
        />
        <div
          style={{
            height: 2,
            width: "92%",
            background: "#e1e3e5",
            marginBottom: 3,
          }}
        />
        <div
          style={{
            height: 2,
            width: "80%",
            background: "#e1e3e5",
            marginBottom: 6,
          }}
        />
        <div
          style={{
            height: 4,
            width: "55%",
            marginLeft: "auto",
            background: theme.secondary,
            borderRadius: 1,
            opacity: 0.55,
          }}
        />
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
