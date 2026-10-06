import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
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
  BASE_LAYOUT_CODES,
  type BaseLayoutCode,
} from "../models/template-config.types";
import {
  createCustomTemplate,
  deleteCustomTemplate,
  getTemplateByIdForShop,
  parseDocumentType,
  saveTemplateAsNew,
  saveTemplateConfig,
  setDefaultTemplate,
} from "../models/template.server";
import { templateSourceKind } from "../models/template-liquid.server";
import { authenticate } from "../shopify.server";

function asBaseLayoutSafe(value: string | null | undefined): BaseLayoutCode {
  const code = (value ?? "modern") as BaseLayoutCode;
  return BASE_LAYOUT_CODES.includes(code) ? code : "modern";
}

function isTemplateDetailsPath(pathname: string): boolean {
  return /^\/app\/templates\/[^/]+$/.test(pathname);
}

function documentTypeLabel(type: DocumentType): string {
  switch (type) {
    case "packing_slip":
      return "Packing slip";
    case "credit_note":
      return "Credit note";
    case "refund_document":
      return "Refund document";
    default:
      return "Tax invoice";
  }
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const templateId = String(params.id ?? "").trim();
  const url = new URL(request.url);
  const isNew = url.searchParams.get("new") === "1";

  if (!templateId) {
    return { result: null, isNew: false };
  }

  let result = await getTemplateByIdForShop(session.shop, templateId);

  // Old parity: opening a system template for edit clones it first.
  if (result?.template.isSystem) {
    const cloned = await createCustomTemplate(session.shop, {
      name: "",
      baseLayoutCode: asBaseLayoutSafe(result.template.baseLayoutCode),
      documentType: result.documentType,
      sourceTemplateId: result.template.id,
    });
    if (cloned) {
      throw redirect(
        `/app/templates/${encodeURIComponent(cloned.id)}?new=1`,
      );
    }
  }

  result = await getTemplateByIdForShop(session.shop, templateId);
  if (!result) {
    return { result: null, isNew };
  }

  const defaultId =
    result.documentType === "packing_slip"
      ? result.store.defaultPackingSlipTemplateId
      : result.documentType === "credit_note"
        ? result.store.defaultCreditNoteTemplateId
        : result.documentType === "refund_document"
          ? result.store.defaultRefundDocumentTemplateId
          : result.store.defaultTemplateId;

  return {
    result: {
      id: result.template.id,
      name: result.template.name,
      description: result.template.description ?? "",
      code: result.template.code,
      documentType: result.documentType,
      baseLayoutCode: result.template.baseLayoutCode,
      sourceType: templateSourceKind(result.template),
      isSystem: result.template.isSystem,
      isDefault: result.template.id === defaultId,
      config: result.config,
    },
    isNew,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const templateId = String(params.id ?? formData.get("templateId") ?? "").trim();

  if (intent === "save") {
    if (!templateId) {
      return {
        ok: false as const,
        intent: "save" as const,
        error: "Template not found or cannot be edited",
      };
    }
    const name = String(formData.get("name") ?? "");
    const existing = await getTemplateByIdForShop(session.shop, templateId);
    if (!existing || existing.template.isSystem) {
      return {
        ok: false as const,
        intent: "save" as const,
        error: "Template not found or cannot be edited",
      };
    }
    try {
      const updated = await saveTemplateConfig(session.shop, templateId, {
        name,
        config: existing.config,
      });
      if (!updated) {
        return {
          ok: false as const,
          intent: "save" as const,
          error: "Template not found or cannot be edited",
        };
      }
      return {
        ok: true as const,
        intent: "save" as const,
        message: "Template saved",
      };
    } catch {
      return {
        ok: false as const,
        intent: "save" as const,
        error: "Invalid template configuration",
      };
    }
  }

  if (intent === "save-as") {
    if (!templateId) {
      return {
        ok: false as const,
        intent: "save-as" as const,
        error: "Template not found",
      };
    }
    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      return {
        ok: false as const,
        intent: "save-as" as const,
        error: "Template name is required",
      };
    }
    const existing = await getTemplateByIdForShop(session.shop, templateId);
    if (!existing) {
      return {
        ok: false as const,
        intent: "save-as" as const,
        error: "Template not found",
      };
    }
    try {
      const created = await saveTemplateAsNew(session.shop, templateId, {
        name,
        config: existing.config,
      });
      if (!created) {
        return {
          ok: false as const,
          intent: "save-as" as const,
          error: "Template not found",
        };
      }
      return {
        ok: true as const,
        intent: "save-as" as const,
        templateId: created.id,
        message: "Template created",
      };
    } catch {
      return {
        ok: false as const,
        intent: "save-as" as const,
        error: "Invalid template configuration",
      };
    }
  }

  if (intent === "set-default") {
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
      message: `Default ${documentTypeLabel(parseDocumentType(updated.documentType)).toLowerCase()} template updated.`,
    };
  }

  if (intent === "delete") {
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
      redirectTo: `/app/templates?type=${encodeURIComponent(
        String(formData.get("documentType") ?? "tax_invoice"),
      )}`,
    };
  }

  return {
    ok: false as const,
    intent: "unknown" as const,
    error: "Unknown action",
  };
};

const MORE_MENU_ID = "template-details-more-actions";

export default function TemplateDetailsPage() {
  const { result, isNew } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState(result?.name ?? "");
  const [saveAsName, setSaveAsName] = useState("");
  const [showSaveAs, setShowSaveAs] = useState(false);
  const awaiting = useRef(false);
  const dataAtSubmit = useRef(fetcher.data);

  const loadingDetails =
    navigation.state !== "idle" &&
    navigation.location != null &&
    isTemplateDetailsPath(navigation.location.pathname);
  const busy =
    fetcher.state === "submitting" || fetcher.state === "loading";

  useEffect(() => {
    setName(result?.name ?? "");
  }, [result?.id, result?.name]);

  useEffect(() => {
    if (!loadingDetails) return;
    shopify.loading(true);
    return () => {
      shopify.loading(false);
    };
  }, [loadingDetails, shopify]);

  useEffect(() => {
    if (!awaiting.current || fetcher.state !== "idle") return;
    awaiting.current = false;

    if (!fetcher.data || fetcher.data === dataAtSubmit.current) {
      shopify.toast.show("Couldn't save", { isError: true });
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
      fetcher.data.intent === "save-as" &&
      "templateId" in fetcher.data &&
      fetcher.data.templateId
    ) {
      shopify.toast.show(fetcher.data.message);
      navigate(
        `/app/templates/${encodeURIComponent(fetcher.data.templateId)}?saved=1`,
      );
      return;
    }

    if (
      fetcher.data.intent === "delete" &&
      "redirectTo" in fetcher.data &&
      fetcher.data.redirectTo
    ) {
      shopify.toast.show(fetcher.data.message);
      navigate(fetcher.data.redirectTo);
      return;
    }

    shopify.toast.show(
      "message" in fetcher.data ? fetcher.data.message : "Saved",
    );
    setShowSaveAs(false);
    setSaveAsName("");
  }, [fetcher.state, fetcher.data, navigate, shopify]);

  if (!result) {
    return (
      <s-page heading="Template not found">
        <s-link slot="breadcrumb-actions" href="/app/templates">
          Templates
        </s-link>
        <s-section accessibilityLabel="Template not found">
          <s-banner tone="critical" heading="Template not found">
            This template could not be loaded. It may have been deleted or does
            not belong to this store.
          </s-banner>
          <s-button variant="primary" href="/app/templates">
            Back to Templates
          </s-button>
        </s-section>
      </s-page>
    );
  }

  const listHref = `/app/templates?type=${encodeURIComponent(result.documentType)}`;
  const nameRequiredBlank = !name.trim();
  const isUntitled = isNew || nameRequiredBlank || searchParams.get("new") === "1";

  const submit = (intent: string, fields: Record<string, string> = {}) => {
    if (busy) return;
    dataAtSubmit.current = fetcher.data;
    awaiting.current = true;
    const body = new FormData();
    body.set("intent", intent);
    body.set("templateId", result.id);
    body.set("documentType", result.documentType);
    for (const [key, value] of Object.entries(fields)) {
      body.set(key, value);
    }
    fetcher.submit(body, { method: "post" });
  };

  return (
    <s-page heading={result.name || "Untitled template"}>
      <s-link slot="breadcrumb-actions" href={listHref}>
        Templates
      </s-link>

      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => {
          if (!name.trim()) {
            shopify.toast.show("Template name can't be blank.", {
              isError: true,
            });
            return;
          }
          submit("save", { name });
        }}
        {...(busy || result.isSystem
          ? { loading: busy, disabled: true }
          : {})}
      >
        Save
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        commandFor={MORE_MENU_ID}
        {...(busy ? { disabled: true } : {})}
      >
        More actions
      </s-button>
      <s-menu
        id={MORE_MENU_ID}
        accessibilityLabel={`More actions for ${result.name}`}
      >
        {!isUntitled ? (
          <s-button
            icon="duplicate"
            onClick={() => {
              setSaveAsName(`${result.name} (copy)`);
              setShowSaveAs(true);
            }}
          >
            Save as
          </s-button>
        ) : null}
        {!result.isDefault ? (
          <s-button
            icon="check"
            onClick={() => submit("set-default")}
          >
            Set as default
          </s-button>
        ) : (
          <s-button icon="check" disabled>
            Applied
          </s-button>
        )}
        {!result.isSystem && !result.isDefault ? (
          <s-button
            icon="delete"
            tone="critical"
            onClick={() => {
              if (!window.confirm("Delete this template?")) return;
              submit("delete");
            }}
          >
            Delete
          </s-button>
        ) : null}
      </s-menu>

      <s-section heading="Template details">
        <s-stack gap="base">
          {result.isSystem ? (
            <s-banner tone="info" heading="System template">
              System templates cannot be edited in place. A custom copy is
              created when you open them for editing.
            </s-banner>
          ) : (
            <s-banner tone="info" heading="Phase A editor">
              Name and defaults are managed here. Visual configuration and
              Liquid editing arrive in later Group 14 phases.
            </s-banner>
          )}

          <s-text-field
            label="Name"
            value={name}
            maxLength={80}
            onInput={(event: Event) => {
              setName((event.currentTarget as HTMLInputElement).value);
            }}
            {...(result.isSystem ? { disabled: true } : {})}
          />

          <s-stack gap="small">
            <s-stack gap="none">
              <s-text color="subdued">Document type</s-text>
              <s-text>{documentTypeLabel(result.documentType)}</s-text>
            </s-stack>
            <s-stack gap="none">
              <s-text color="subdued">Layout</s-text>
              <s-text>{result.baseLayoutCode}</s-text>
            </s-stack>
            <s-stack gap="none">
              <s-text color="subdued">Code</s-text>
              <s-text>{result.code}</s-text>
            </s-stack>
            <s-stack gap="none">
              <s-text color="subdued">Source</s-text>
              <s-text>{result.sourceType}</s-text>
            </s-stack>
            <s-stack gap="none">
              <s-text color="subdued">Default</s-text>
              <s-text>{result.isDefault ? "Yes" : "No"}</s-text>
            </s-stack>
          </s-stack>
        </s-stack>
      </s-section>

      {showSaveAs ? (
        <s-section heading="Save as new template">
          <s-stack gap="base">
            <s-text-field
              label="New template name"
              value={saveAsName}
              maxLength={80}
              onInput={(event: Event) => {
                setSaveAsName(
                  (event.currentTarget as HTMLInputElement).value,
                );
              }}
            />
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                onClick={() => {
                  if (!saveAsName.trim()) {
                    shopify.toast.show("Template name can't be blank.", {
                      isError: true,
                    });
                    return;
                  }
                  submit("save-as", { name: saveAsName.trim() });
                }}
                {...(busy ? { loading: true, disabled: true } : {})}
              >
                Create copy
              </s-button>
              <s-button
                variant="secondary"
                onClick={() => {
                  setShowSaveAs(false);
                  setSaveAsName("");
                }}
              >
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
