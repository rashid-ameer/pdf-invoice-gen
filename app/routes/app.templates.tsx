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

const DELETE_MODAL_ID = "delete-template-modal";
const DELETE_DISABLED_TOOLTIP_ID = "delete-selected-template-tooltip";

/** 1 col mobile → 2 tablet → 4 desktop (container-query range syntax). */
const CARD_GRID_COLUMNS =
  "@container (inline-size < 560px) 1fr, (560px <= inline-size < 768px) 1fr 1fr, 1fr 1fr 1fr 1fr";

const FILTER_ROW_COLUMNS =
  "@container (inline-size > 480px) 1fr auto, 1fr";

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
  const [deleteTarget, setDeleteTarget] = useState<TemplateListItem | null>(
    null,
  );
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const awaiting = useRef(false);
  const dataAtSubmit = useRef(fetcher.data);

  const loading =
    navigation.state === "loading" &&
    navigation.location != null &&
    isTemplatesListPath(navigation.location.pathname);
  const busy =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const createBusy = busy && !selectingId && !deletingId;

  useEffect(() => {
    if (fetcher.state === "idle") {
      setSelectingId(null);
    }
  }, [fetcher.state]);

  useEffect(() => {
    if (!awaiting.current || fetcher.state !== "idle") return;
    awaiting.current = false;

    if (!fetcher.data || fetcher.data === dataAtSubmit.current) {
      shopify.toast.show("Couldn't update templates", { isError: true });
      setDeletingId(null);
      return;
    }

    if (!fetcher.data.ok) {
      shopify.toast.show(
        ("error" in fetcher.data && fetcher.data.error) || "Request failed",
        { isError: true },
      );
      setDeletingId(null);
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

    if (fetcher.data.intent === "delete") {
      shopify.toast.show(
        "message" in fetcher.data ? fetcher.data.message : "Done",
      );
      setDeletingId(null);
      setDeleteTarget(null);
      const modal = document.getElementById(DELETE_MODAL_ID) as
        | (HTMLElement & { hideOverlay?: () => void })
        | null;
      modal?.hideOverlay?.();
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

  const createNewTemplate = () => {
    submitIntent("create-code", { documentType: data.documentType });
  };

  const clearSearchAndFilters = () => {
    setSearchDraft("");
    setKindFilter("all");
  };

  const matchesSearch = (item: TemplateListItem) => {
    const q = searchDraft.trim().toLowerCase();
    if (!q) return true;
    const haystack =
      `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
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

  const visibleItems = useMemo(
    () => [
      ...(showCustom ? customItems : []),
      ...(showSystem ? systemItems : []),
    ],
    [showCustom, showSystem, customItems, systemItems],
  );

  const hasSearchQuery = Boolean(searchDraft.trim());
  const showCustomEmpty =
    kindFilter === "custom" &&
    !hasSearchQuery &&
    data.customItems.length === 0;
  const showNoResults = !showCustomEmpty && visibleItems.length === 0;

  return (
    <s-page heading="Templates">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={createNewTemplate}
        {...(createBusy ? { loading: true, disabled: true } : {})}
      >
        Create new template
      </s-button>

      <s-stack gap="base">
        <s-grid
          gridTemplateColumns="repeat(4, auto)"
          gap="small-200"
          alignItems="center"
          justifyContent="start"
          accessibilityLabel="Document type"
        >
          {DOC_TYPES.map((type) => {
            const selected = data.documentType === type.value;
            return (
              <s-clickable
                key={type.value}
                paddingBlock="small-200"
                paddingInline="base"
                border="none"
                borderRadius="base"
                background={selected ? "base" : "transparent"}
                accessibilityLabel={`${type.label}${selected ? ", selected" : ""}`}
                onClick={() => switchType(type.value)}
              >
                <s-text type="strong">
                  {type.label}
                </s-text>
              </s-clickable>
            );
          })}
        </s-grid>

        <s-query-container>
          <s-grid
            gridTemplateColumns={FILTER_ROW_COLUMNS}
            gap="small-200"
            alignItems="end"
          >
            <s-text-field
              label="Search"
              labelAccessibilityVisibility="exclusive"
              icon="search"
              placeholder="Search templates"
              value={searchDraft}
              autocomplete="off"
              onInput={(event: Event) => {
                setSearchDraft(
                  (event.currentTarget as HTMLInputElement).value,
                );
              }}
            />
            <s-select
              label="Template type"
              labelAccessibilityVisibility="exclusive"
              value={kindFilter}
              onChange={(event: Event) => {
                const value = (event.currentTarget as HTMLSelectElement).value;
                if (value === "all" || value === "custom" || value === "system") {
                  setKindFilter(value);
                }
              }}
            >
              <s-option value="all">All templates</s-option>
              <s-option value="custom">Custom</s-option>
              <s-option value="system">System</s-option>
            </s-select>
          </s-grid>
        </s-query-container>

        {loading ? (
          <s-stack alignItems="center" gap="base" padding="large">
            <s-spinner
              accessibilityLabel="Loading templates"
              size="large"
            />
            <s-text>Loading templates...</s-text>
          </s-stack>
        ) : showCustomEmpty ? (
          <s-section accessibilityLabel="No custom templates">
            <s-empty-state heading="You don't have any custom templates yet">
              <s-text slot="subheading" color="subdued">
                Edit a system template to create your own, or create a new one
              </s-text>
              <s-button
                slot="primary-action"
                variant="primary"
                onClick={createNewTemplate}
                {...(createBusy ? { loading: true, disabled: true } : {})}
              >
                Create new template
              </s-button>
            </s-empty-state>
          </s-section>
        ) : showNoResults ? (
          <s-section accessibilityLabel="No templates found">
            <s-empty-state heading="No templates found">
              <s-text slot="subheading" color="subdued">
                Try changing the search or filter
              </s-text>
              <s-button
                slot="primary-action"
                variant="primary"
                onClick={clearSearchAndFilters}
              >
                Clear search and filters
              </s-button>
            </s-empty-state>
          </s-section>
        ) : (
          <s-query-container>
            <s-grid gridTemplateColumns={CARD_GRID_COLUMNS} gap="base">
              {visibleItems.map((item) => (
                <TemplateCard
                  key={item.id}
                  item={item}
                  selectLoading={selectingId === item.id && busy}
                  onEdit={() =>
                    navigate(`/app/templates/${encodeURIComponent(item.id)}`)
                  }
                  onSelect={() => {
                    setSelectingId(item.id);
                    submitIntent("set-default", { templateId: item.id });
                  }}
                  onRequestDelete={() => setDeleteTarget(item)}
                />
              ))}
            </s-grid>
          </s-query-container>
        )}
      </s-stack>

      <s-modal
        id={DELETE_MODAL_ID}
        heading={
          deleteTarget
            ? `Delete "${deleteTarget.name}"?`
            : "Delete template?"
        }
      >
        <s-text>
          This can&apos;t be undone. Documents you already created keep their
          original layout.
        </s-text>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={DELETE_MODAL_ID}
          command="--hide"
          onClick={() => {
            if (deletingId) return;
            setDeleteTarget(null);
          }}
          {...(deletingId ? { disabled: true } : {})}
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={() => {
            if (!deleteTarget || deletingId) return;
            setDeletingId(deleteTarget.id);
            submitIntent("delete", { templateId: deleteTarget.id });
          }}
          {...(deletingId ? { loading: true } : {})}
        >
          Delete
        </s-button>
      </s-modal>

      <s-tooltip id={DELETE_DISABLED_TOOLTIP_ID}>
        <s-text>Select another template before deleting</s-text>
      </s-tooltip>
    </s-page>
  );
}

function TemplateCard({
  item,
  selectLoading,
  onEdit,
  onSelect,
  onRequestDelete,
}: {
  item: TemplateListItem;
  selectLoading: boolean;
  onEdit: () => void;
  onSelect: () => void;
  onRequestDelete: () => void;
}) {
  const isSelected = item.isDefault;
  const deleteDisabled = isSelected;
  const actionColumns = item.isCustom ? "1fr 1fr auto" : "1fr 1fr";

  return (
    <s-section
      padding="base"
      accessibilityLabel={`${item.name}${isSelected ? ", selected" : ""}`}
    >
      <s-stack gap="base">
        <TemplatePreview
          dataUrl={item.thumbnailDataUrl}
          fetchUrl={item.thumbnailUrl}
          name={item.name}
        />

        <s-stack gap="small-200">
          <s-heading lineClamp={1}>{item.name}</s-heading>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-badge tone="neutral">
              {item.isSystem ? "System" : "Custom"}
            </s-badge>
            {isSelected ? <s-badge tone="success">Selected</s-badge> : null}
          </s-stack>
        </s-stack>

        <s-grid gridTemplateColumns={actionColumns} gap="small-200">
          <s-button variant="secondary" inlineSize="fill" onClick={onEdit}>
            Edit
          </s-button>
          {isSelected ? (
            <s-button variant="secondary" inlineSize="fill" disabled>
              Selected
            </s-button>
          ) : (
            <s-button
              variant="secondary"
              inlineSize="fill"
              onClick={onSelect}
              {...(selectLoading ? { loading: true } : {})}
            >
              Select
            </s-button>
          )}
          {item.isCustom ? (
            <s-button
              icon="delete"
              variant="secondary"
              tone="critical"
              inlineSize="fill"
              accessibilityLabel={`Delete ${item.name}`}
              {...(deleteDisabled
                ? {
                    disabled: true,
                    interestFor: DELETE_DISABLED_TOOLTIP_ID,
                  }
                : {
                    commandFor: DELETE_MODAL_ID,
                    command: "--show" as const,
                    onClick: onRequestDelete,
                  })}
            />
          ) : null}
        </s-grid>
      </s-stack>
    </s-section>
  );
}

/**
 * List thumbnail: prefer cached data URL from the loader (no auth needed).
 * Fall back to s-image placeholder, then fetch JPEG with App Bridge Bearer
 * when cache is still empty.
 */
function TemplatePreview({
  dataUrl,
  fetchUrl,
  name,
}: {
  dataUrl: string | null;
  fetchUrl: string;
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
        // Keep s-image placeholder — never force a blank failed state.
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [dataUrl, fetchUrl, shopify]);

  const src = dataUrl || objectUrl || undefined;

  return (
    <s-image
      {...(src ? { src } : {})}
      alt={`${name} preview`}
      aspectRatio="3/4"
      objectFit="cover"
      inlineSize="fill"
      border="base"
      borderRadius="base"
      loading="lazy"
    />
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
