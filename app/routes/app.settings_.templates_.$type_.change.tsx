/**
 * Choose a template (Screen 2): gallery for one document type.
 * Actions (create / set-default / delete) moved here from the former list page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
  useParams,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  CARD_GRID_COLUMNS,
  DELETE_DISABLED_TOOLTIP_ID,
  DELETE_MODAL_ID,
  TemplateCard,
} from "../components/template-list-card";
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
import type { DocumentType } from "../types/index";
import {
  TEMPLATE_DOC_TYPES,
  parseTemplateTypeParam,
  templatesOverviewHref,
} from "../utils/template-type-slug";

function documentTypePluralLower(type: DocumentType): string {
  return (
    TEMPLATE_DOC_TYPES.find((t) => t.value === type)?.pluralLower ?? type
  );
}

function documentTypeLabel(type: DocumentType): string {
  return TEMPLATE_DOC_TYPES.find((t) => t.value === type)?.label ?? type;
}

function isChangePath(pathname: string): boolean {
  return /^\/app\/settings\/templates\/[^/]+\/change\/?$/.test(pathname);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const documentType = parseTemplateTypeParam(params.type);

  if (!documentType) {
    return {
      ok: false as const,
      invalidType: params.type ?? "",
      documentType: null as DocumentType | null,
      customItems: [] as TemplateListItem[],
      systemItems: [] as TemplateListItem[],
    };
  }

  // Omit embedded JPEG blobs — gallery cards fetch /thumbnail lazily.
  // Shipping every thumbnail as base64 was making this navigation feel slow.
  const list = await getTemplatesForShop(session.shop, documentType, {
    embedThumbnails: false,
  });
  if (!list) {
    throw new Response("Store not found. Please reinstall the app.", {
      status: 404,
    });
  }

  for (const item of [...list.customItems, ...list.systemItems]) {
    if (!item.thumbnailDataUrl || item.tags.includes("Liquid")) {
      scheduleTemplateThumbnailRefresh(session.shop, item.id);
    }
  }

  return {
    ok: true as const,
    invalidType: null as string | null,
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

export default function ChooseTemplatePage() {
  const data = useLoaderData<typeof loader>();
  const params = useParams();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [kindFilter, setKindFilter] = useState<"all" | "custom" | "system">(
    "all",
  );
  const [searchDraft, setSearchDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TemplateListItem | null>(
    null,
  );
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const awaiting = useRef(false);
  const dataAtSubmit = useRef(fetcher.data);

  const loading =
    navigation.state === "loading" &&
    navigation.location != null &&
    isChangePath(navigation.location.pathname);
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
      const message =
        ("error" in fetcher.data && fetcher.data.error) || "Request failed";
      if (fetcher.data.intent === "set-default") {
        setActionError(message);
      }
      shopify.toast.show(message, { isError: true });
      setDeletingId(null);
      return;
    }

    setActionError(null);

    if (
      (fetcher.data.intent === "create-layout" ||
        fetcher.data.intent === "create-code") &&
      "templateId" in fetcher.data &&
      fetcher.data.templateId
    ) {
      shopify.toast.show(fetcher.data.message);
      navigate(
        `/app/settings/templates/${encodeURIComponent(fetcher.data.templateId)}?new=1`,
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

    if (fetcher.data.intent === "set-default") {
      shopify.toast.show("Template selected");
      return;
    }

    shopify.toast.show(
      "message" in fetcher.data ? fetcher.data.message : "Done",
    );
  }, [fetcher.state, fetcher.data, navigate, shopify]);

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

  if (!data.ok || !data.documentType) {
    return (
      <s-page heading="Choose a template">
        <s-link slot="breadcrumb-actions" href="/app/settings">
          Settings
        </s-link>
        <s-link slot="breadcrumb-actions" href={templatesOverviewHref()}>
          Templates
        </s-link>
        <s-section>
          <s-stack gap="base">
            <s-banner tone="critical" heading="Unknown document type">
              “{params.type || data.invalidType || "missing"}” is not a valid
              template type.
            </s-banner>
            <s-button variant="primary" href={templatesOverviewHref()}>
              Back to templates
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const documentType = data.documentType;
  const overviewHref = templatesOverviewHref(documentType);

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
    submitIntent("create-code", { documentType });
  };

  const clearSearchAndFilters = () => {
    setSearchDraft("");
    setKindFilter("all");
  };

  return (
    <s-page heading="Choose a template">
      <s-link slot="breadcrumb-actions" href="/app/settings">
        Settings
      </s-link>
      <s-link slot="breadcrumb-actions" href={overviewHref}>
        Templates
      </s-link>

      <s-stack gap="base">
        <s-text color="subdued">
          For {documentTypePluralLower(documentType)}
        </s-text>

        {actionError ? (
          <s-banner
            tone="critical"
            heading="Couldn't select template"
            onDismiss={() => setActionError(null)}
          >
            {actionError}
          </s-banner>
        ) : null}

        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 480px) 1fr auto, 1fr"
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
            <s-grid
              gridTemplateColumns="@container (inline-size > 480px) auto auto, 1fr 1fr"
              gap="small-200"
              alignItems="end"
            >
              <s-select
                label="Template type"
                labelAccessibilityVisibility="exclusive"
                value={kindFilter}
                onChange={(event: Event) => {
                  const value = (event.currentTarget as HTMLSelectElement)
                    .value;
                  if (
                    value === "all" ||
                    value === "custom" ||
                    value === "system"
                  ) {
                    setKindFilter(value);
                  }
                }}
              >
                <s-option value="all">All templates</s-option>
                <s-option value="custom">Custom</s-option>
                <s-option value="system">System</s-option>
              </s-select>
              <s-button
                variant="primary"
                onClick={createNewTemplate}
                {...(createBusy ? { loading: true, disabled: true } : {})}
              >
                Create new template
              </s-button>
            </s-grid>
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
                    navigate(`/app/settings/templates/${encodeURIComponent(item.id)}`)
                  }
                  onSelect={() => {
                    setActionError(null);
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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
