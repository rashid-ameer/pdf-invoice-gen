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
  useRouteError,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { SettingsTemplatesBreadcrumbs } from "../components/settings-templates-breadcrumbs";
import { TemplateVisualConfigEditor } from "../components/template-visual-config-editor";
import type { DocumentType } from "../types/index";
import {
  BASE_LAYOUT_CODES,
  layoutEditorCapabilities,
  type BaseLayoutCode,
  type TemplateConfig,
} from "../models/template-config.types";
import {
  blockingLiquidErrorsForEditor,
  createCustomTemplate,
  deleteCustomTemplate,
  getTemplateByIdForShop,
  getTemplateLiquidSourceForShop,
  parseConfigJsonFromForm,
  parseDocumentType,
  previewTemplateVisualConfig,
  saveTemplateAsNew,
  saveTemplateConfig,
  setDefaultTemplate,
  syncConfigToLiquidForShop,
  validateTemplateLiquidForShop,
} from "../models/template.server";
import { extractVisualConfigFromLiquid } from "../models/template-liquid-extract";
import { templateSourceKind } from "../models/template-liquid.server";
import { scheduleTemplateThumbnailRefresh } from "../models/template-thumbnail.server";
import { authenticate } from "../shopify.server";

const SAVE_BAR_ID = "template-visual-config-save-bar";
const SAVE_MODAL_ID = "template-editor-save-modal";
/** Controls ~40% / preview ~60%; lower breakpoint so base page width still gets two columns. */
const EDITOR_LAYOUT_COLS =
  "@container (inline-size > 600px) 2fr 3fr, 1fr";
const TEMPLATE_NAME_MAX = 60;

type EditorSourceType = "layout" | "code" | "imported";
type EditorView = "preview" | "code";
type LiquidCheck = {
  errors: string[];
  warnings: string[];
  checks: Array<{
    id: string;
    label: string;
    ok: boolean;
    level: "error" | "warning";
  }>;
  syntaxLine: number | null;
};

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

function documentTypeTitle(type: DocumentType): string {
  switch (type) {
    case "packing_slip":
      return "packing slip";
    case "credit_note":
      return "credit note";
    case "refund_document":
      return "refund document";
    default:
      return "tax invoice";
  }
}

function validateTemplateName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Template name is required";
  if (trimmed.length > TEMPLATE_NAME_MAX) {
    return `Template name must be ${TEMPLATE_NAME_MAX} characters or fewer`;
  }
  return null;
}

function stableConfigKey(config: TemplateConfig): string {
  return JSON.stringify(config);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const templateId = String(params.id ?? "").trim();
  const url = new URL(request.url);
  const isNew = url.searchParams.get("new") === "1";

  if (!templateId) {
    return { result: null, isNew: false };
  }

  // System templates open for inspection (read-only). Cloning happens only via
  // explicit Customize (list create-layout or details intent=customize) — old
  // list Edit posted to /create; navigating to the system id must not auto-clone.
  const result = await getTemplateByIdForShop(session.shop, templateId);
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

  const sourceType = templateSourceKind(result.template);
  const caps = layoutEditorCapabilities(
    asBaseLayoutSafe(result.template.baseLayoutCode),
  );
  const liquidSource = await getTemplateLiquidSourceForShop(
    session.shop,
    result.template.id,
  );

  return {
    result: {
      id: result.template.id,
      name: result.template.name,
      description: result.template.description ?? "",
      code: result.template.code,
      documentType: result.documentType,
      baseLayoutCode: asBaseLayoutSafe(result.template.baseLayoutCode),
      sourceType,
      liquidHtml:
        typeof result.template.customHtml === "string"
          ? result.template.customHtml
          : (liquidSource?.liquidHtml ?? ""),
      customCss:
        typeof result.template.customCss === "string"
          ? result.template.customCss
          : "",
      codeEditor: caps.codeEditor,
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

  // Explicit customize: clone system → custom, then open the editable copy.
  if (intent === "customize") {
    if (!templateId) {
      return {
        ok: false as const,
        intent: "customize" as const,
        error: "Template not found",
      };
    }
    const existing = await getTemplateByIdForShop(session.shop, templateId);
    if (!existing?.template.isSystem) {
      return {
        ok: false as const,
        intent: "customize" as const,
        error: "Only system templates can be customized this way",
      };
    }
    const cloned = await createCustomTemplate(session.shop, {
      name: "",
      baseLayoutCode: asBaseLayoutSafe(existing.template.baseLayoutCode),
      documentType: existing.documentType,
      sourceTemplateId: existing.template.id,
    });
    if (!cloned) {
      return {
        ok: false as const,
        intent: "customize" as const,
        error: "Store not found",
      };
    }
    scheduleTemplateThumbnailRefresh(session.shop, cloned.id);
    return {
      ok: true as const,
      intent: "customize" as const,
      templateId: cloned.id,
      message: "Template created",
    };
  }

  if (intent === "preview") {
    if (!templateId) {
      return {
        ok: false as const,
        intent: "preview" as const,
        error: "Template not found",
      };
    }
    let draftConfig: unknown;
    const configJson = formData.get("configJson");
    if (typeof configJson === "string" && configJson.trim()) {
      try {
        draftConfig = JSON.parse(configJson);
      } catch {
        draftConfig = undefined;
      }
    }
    const sourceTypeRaw = String(formData.get("sourceType") ?? "");
    const sourceType =
      sourceTypeRaw === "code" ||
      sourceTypeRaw === "layout" ||
      sourceTypeRaw === "imported"
        ? sourceTypeRaw
        : undefined;
    const liquidHtml =
      typeof formData.get("liquidHtml") === "string"
        ? String(formData.get("liquidHtml"))
        : undefined;
    const customCss =
      typeof formData.get("customCss") === "string"
        ? String(formData.get("customCss"))
        : undefined;
    try {
      const html = await previewTemplateVisualConfig(session.shop, templateId, {
        config: draftConfig,
        liquidHtml,
        customCss,
        sourceType,
      });
      if (!html) {
        return {
          ok: false as const,
          intent: "preview" as const,
          error: "Template not found",
        };
      }
      return {
        ok: true as const,
        intent: "preview" as const,
        html,
      };
    } catch (error) {
      console.error("[templates] visual preview error:", error);
      return {
        ok: false as const,
        intent: "preview" as const,
        error: "Failed to render preview",
      };
    }
  }

  if (intent === "validate") {
    if (!templateId) {
      return {
        ok: false as const,
        intent: "validate" as const,
        error: "Template not found",
      };
    }
    const liquidHtml = String(formData.get("liquidHtml") ?? "");
    const check = await validateTemplateLiquidForShop(
      session.shop,
      templateId,
      liquidHtml,
    );
    if (!check) {
      return {
        ok: false as const,
        intent: "validate" as const,
        error: "Template not found",
      };
    }
    return {
      ok: true as const,
      intent: "validate" as const,
      validation: check,
    };
  }

  if (intent === "from-config") {
    if (!templateId) {
      return {
        ok: false as const,
        intent: "from-config" as const,
        error: "Template not found",
      };
    }
    let config: unknown;
    let previousConfig: unknown;
    const configJson = formData.get("configJson");
    const previousJson = formData.get("previousConfigJson");
    try {
      if (typeof configJson === "string" && configJson.trim()) {
        config = JSON.parse(configJson);
      }
      if (typeof previousJson === "string" && previousJson.trim()) {
        previousConfig = JSON.parse(previousJson);
      }
    } catch {
      return {
        ok: false as const,
        intent: "from-config" as const,
        error: "Invalid template configuration",
      };
    }
    try {
      const synced = await syncConfigToLiquidForShop(session.shop, templateId, {
        config,
        previousConfig,
        liquidHtml: String(formData.get("liquidHtml") ?? ""),
      });
      if (!synced) {
        return {
          ok: false as const,
          intent: "from-config" as const,
          error: "Template not found",
        };
      }
      return {
        ok: true as const,
        intent: "from-config" as const,
        liquidHtml: synced.liquidHtml,
      };
    } catch {
      return {
        ok: false as const,
        intent: "from-config" as const,
        error: "Failed to sync template code",
      };
    }
  }

  if (intent === "load-source" || intent === "load-starter") {
    if (!templateId) {
      return {
        ok: false as const,
        intent: intent as "load-source" | "load-starter",
        error: "Template not found",
      };
    }
    const source = await getTemplateLiquidSourceForShop(
      session.shop,
      templateId,
      { starter: intent === "load-starter" },
    );
    if (!source) {
      return {
        ok: false as const,
        intent: intent as "load-source" | "load-starter",
        error: "Template not found",
      };
    }
    return {
      ok: true as const,
      intent: intent as "load-source" | "load-starter",
      liquidHtml: source.liquidHtml,
      customCss: source.customCss,
      sourceType: source.sourceType,
    };
  }

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
    const sourceTypeRaw = String(formData.get("sourceType") ?? "");
    const sourceType =
      sourceTypeRaw === "code" || sourceTypeRaw === "layout"
        ? sourceTypeRaw
        : undefined;
    const liquidHtml = String(formData.get("liquidHtml") ?? "");
    const customCss = String(formData.get("customCss") ?? "");
    const editorMode =
      String(formData.get("editorMode") ?? "") === "code" ? "code" : "visual";

    if (sourceType === "code") {
      const check = await validateTemplateLiquidForShop(
        session.shop,
        templateId,
        liquidHtml,
      );
      if (!check) {
        return {
          ok: false as const,
          intent: "save" as const,
          error: "Template not found or cannot be edited",
        };
      }
      const blocking = blockingLiquidErrorsForEditor(check, editorMode);
      if (blocking.length) {
        return {
          ok: false as const,
          intent: "save" as const,
          error: blocking.join(" "),
          validation: check,
        };
      }
    }

    try {
      const parsedConfig = parseConfigJsonFromForm(
        existing.config,
        formData.get("configJson"),
        existing.documentType,
      );
      const updated = await saveTemplateConfig(session.shop, templateId, {
        name,
        config: parsedConfig ?? existing.config,
        sourceType,
        liquidHtml,
        customCss,
      });
      if (!updated) {
        return {
          ok: false as const,
          intent: "save" as const,
          error: "Template not found or cannot be edited",
        };
      }
      scheduleTemplateThumbnailRefresh(session.shop, templateId);
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
    const sourceTypeRaw = String(formData.get("sourceType") ?? "");
    const sourceType =
      sourceTypeRaw === "code" || sourceTypeRaw === "layout"
        ? sourceTypeRaw
        : undefined;
    const liquidHtml = String(formData.get("liquidHtml") ?? "");
    const customCss = String(formData.get("customCss") ?? "");

    if (sourceType === "code") {
      const check = await validateTemplateLiquidForShop(
        session.shop,
        templateId,
        liquidHtml,
      );
      if (check && check.errors.length) {
        return {
          ok: false as const,
          intent: "save-as" as const,
          error: check.errors.join(" "),
          validation: check,
        };
      }
    }

    try {
      const parsedConfig = parseConfigJsonFromForm(
        existing.config,
        formData.get("configJson"),
        existing.documentType,
      );
      const created = await saveTemplateAsNew(session.shop, templateId, {
        name,
        config: parsedConfig ?? existing.config,
      });
      if (!created) {
        return {
          ok: false as const,
          intent: "save-as" as const,
          error: "Template not found",
        };
      }
      if (sourceType) {
        await saveTemplateConfig(session.shop, created.id, {
          name,
          config: parsedConfig ?? existing.config,
          sourceType,
          liquidHtml,
          customCss,
        });
      }
      scheduleTemplateThumbnailRefresh(session.shop, created.id);
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
      redirectTo: `/app/settings/templates?type=${encodeURIComponent(
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

export default function TemplateDetailsPage() {
  const { result, isNew } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const previewFetcher = useFetcher<typeof action>();
  const syncFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();

  const [name, setName] = useState(result?.name ?? "");
  const [config, setConfig] = useState<TemplateConfig | null>(
    result?.config ?? null,
  );
  const [baselineName, setBaselineName] = useState(result?.name ?? "");
  const [baselineConfig, setBaselineConfig] = useState<TemplateConfig | null>(
    result ? structuredClone(result.config) : null,
  );
  const [sourceType, setSourceType] = useState<EditorSourceType>(
    (result?.sourceType as EditorSourceType) ?? "layout",
  );
  const [liquidHtml, setLiquidHtml] = useState(result?.liquidHtml ?? "");
  const [customCss, setCustomCss] = useState(result?.customCss ?? "");
  const [baselineLiquid, setBaselineLiquid] = useState(result?.liquidHtml ?? "");
  const [baselineCss, setBaselineCss] = useState(result?.customCss ?? "");
  const [baselineSourceType, setBaselineSourceType] = useState<EditorSourceType>(
    (result?.sourceType as EditorSourceType) ?? "layout",
  );
  const [syncedConfig, setSyncedConfig] = useState<TemplateConfig | null>(
    result ? structuredClone(result.config) : null,
  );
  const [editorView] = useState<EditorView>("preview");
  const [liquidValidation, setLiquidValidation] = useState<LiquidCheck | null>(
    null,
  );
  const [logoResetToken, setLogoResetToken] = useState(0);
  const [saveModalName, setSaveModalName] = useState("");
  const [saveModalNameError, setSaveModalNameError] = useState<string | null>(
    null,
  );
  const [customSaveMode, setCustomSaveMode] = useState<"update" | "save-as">(
    "update",
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [savingInModal, setSavingInModal] = useState(false);
  const awaiting = useRef(false);
  const dataAtSubmit = useRef(fetcher.data);
  const saveToastKind = useRef<"saved" | "updated">("updated");
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped on discard so in-flight config→liquid sync cannot re-dirty the form. */
  const syncEpochRef = useRef(0);
  const syncSubmitEpochRef = useRef(0);
  const applyingCode = useRef(false);
  const applyingForm = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const loadingDetails =
    navigation.state !== "idle" &&
    navigation.location != null &&
    isTemplateDetailsPath(navigation.location.pathname);
  const busy =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const previewing =
    previewFetcher.state === "submitting" || previewFetcher.state === "loading";
  const codeEditorAllowed = Boolean(result?.codeEditor);

  const dirty = useMemo(() => {
    if (!result || !config || !baselineConfig) return false;
    return (
      name.trim() !== baselineName.trim() ||
      stableConfigKey(config) !== stableConfigKey(baselineConfig) ||
      liquidHtml !== baselineLiquid ||
      customCss !== baselineCss ||
      sourceType !== baselineSourceType
    );
  }, [
    result,
    config,
    name,
    baselineName,
    baselineConfig,
    liquidHtml,
    baselineLiquid,
    customCss,
    baselineCss,
    sourceType,
    baselineSourceType,
  ]);

  useEffect(() => {
    if (!result) return;
    setName(result.name);
    setConfig(structuredClone(result.config));
    setBaselineName(result.name);
    setBaselineConfig(structuredClone(result.config));
    setSyncedConfig(structuredClone(result.config));
    setSourceType(result.sourceType as EditorSourceType);
    setBaselineSourceType(result.sourceType as EditorSourceType);
    setLiquidHtml(result.liquidHtml);
    setBaselineLiquid(result.liquidHtml);
    setCustomCss(result.customCss);
    setBaselineCss(result.customCss);
    setLogoResetToken((n) => n + 1);
    setSaveError(null);
    setLiquidValidation(null);
  }, [result?.id]);

  useEffect(() => {
    if (!loadingDetails) return;
    shopify.loading(true);
    return () => {
      shopify.loading(false);
    };
  }, [loadingDetails, shopify]);

  useEffect(() => {
    if (!result) {
      shopify.saveBar.hide(SAVE_BAR_ID);
      return;
    }
    if (dirty) {
      shopify.saveBar.show(SAVE_BAR_ID);
    } else {
      shopify.saveBar.hide(SAVE_BAR_ID);
    }
    return () => {
      shopify.saveBar.hide(SAVE_BAR_ID);
    };
  }, [dirty, result, shopify]);

  useEffect(() => {
    if (!awaiting.current || fetcher.state !== "idle") return;
    if (
      fetcher.data &&
      (fetcher.data.intent === "load-source" ||
        fetcher.data.intent === "load-starter" ||
        fetcher.data.intent === "validate" ||
        fetcher.data.intent === "from-config" ||
        fetcher.data.intent === "preview")
    ) {
      return;
    }
    awaiting.current = false;

    if (!fetcher.data || fetcher.data === dataAtSubmit.current) {
      setSaveError("Couldn't save");
      setSavingInModal(false);
      return;
    }

    if (!fetcher.data.ok) {
      const err =
        ("error" in fetcher.data && fetcher.data.error) || "Request failed";
      setSaveError(err);
      setSavingInModal(false);
      if ("validation" in fetcher.data && fetcher.data.validation) {
        setLiquidValidation(fetcher.data.validation as LiquidCheck);
      }
      return;
    }

    setSaveError(null);
    setLiquidValidation(null);
    setSavingInModal(false);

    const listPath = result
      ? `/app/settings/templates?type=${encodeURIComponent(result.documentType)}`
      : "/app/settings/templates";

    if (fetcher.data.intent === "save-as" || fetcher.data.intent === "save") {
      shopify.saveBar.hide(SAVE_BAR_ID);
      void shopify.modal.hide(SAVE_MODAL_ID);
      shopify.toast.show(
        saveToastKind.current === "saved" || fetcher.data.intent === "save-as"
          ? "Template saved"
          : "Template updated",
      );
      open(listPath, "_self");
      return;
    }

    if (
      fetcher.data.intent === "customize" &&
      "templateId" in fetcher.data &&
      fetcher.data.templateId
    ) {
      shopify.toast.show(fetcher.data.message);
      navigate(
        `/app/settings/templates/${encodeURIComponent(fetcher.data.templateId)}?new=1`,
      );
      return;
    }

    if (
      fetcher.data.intent === "delete" &&
      "redirectTo" in fetcher.data &&
      fetcher.data.redirectTo
    ) {
      shopify.saveBar.hide(SAVE_BAR_ID);
      shopify.toast.show(fetcher.data.message);
      navigate(fetcher.data.redirectTo);
      return;
    }

    shopify.toast.show(
      "message" in fetcher.data && fetcher.data.message
        ? fetcher.data.message
        : "Done",
    );
  }, [fetcher.state, fetcher.data, navigate, shopify, result]);

  // Config → Liquid sync when editing code templates from the visual sidebar.
  useEffect(() => {
    if (!result || !config || !codeEditorAllowed) return;
    if (sourceType === "layout" || sourceType === "imported") return;
    if (applyingCode.current || applyingForm.current) return;
    // At last-saved baseline — do not sync (prevents discard → sync → dirty loop).
    if (
      baselineConfig &&
      stableConfigKey(config) === stableConfigKey(baselineConfig) &&
      liquidHtml === baselineLiquid &&
      customCss === baselineCss &&
      sourceType === baselineSourceType
    ) {
      return;
    }
    if (syncTimer.current) clearTimeout(syncTimer.current);
    const epoch = syncEpochRef.current;
    syncTimer.current = setTimeout(() => {
      syncSubmitEpochRef.current = epoch;
      const body = new FormData();
      body.set("intent", "from-config");
      body.set("templateId", result.id);
      body.set("configJson", JSON.stringify(config));
      body.set(
        "previousConfigJson",
        JSON.stringify(syncedConfig ?? result.config),
      );
      body.set("liquidHtml", liquidHtml);
      syncFetcher.submit(body, { method: "post" });
    }, 280);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncFetcher identity churns; liquidHtml read for skip/submit only
  }, [
    result?.id,
    config,
    sourceType,
    codeEditorAllowed,
    baselineConfig,
    baselineLiquid,
    baselineCss,
    baselineSourceType,
  ]);

  useEffect(() => {
    if (syncFetcher.state !== "idle" || !syncFetcher.data) return;
    if (syncFetcher.data.intent !== "from-config" || !syncFetcher.data.ok) return;
    if (!("liquidHtml" in syncFetcher.data)) return;
    if (syncSubmitEpochRef.current !== syncEpochRef.current) return;
    applyingForm.current = true;
    setLiquidHtml(syncFetcher.data.liquidHtml);
    if (config) setSyncedConfig(structuredClone(config));
    applyingForm.current = false;
  }, [syncFetcher.state, syncFetcher.data, config]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (
      fetcher.data.intent !== "load-source" &&
      fetcher.data.intent !== "load-starter"
    ) {
      return;
    }
    if (!fetcher.data.ok) return;
    if ("liquidHtml" in fetcher.data) {
      applyingForm.current = true;
      setLiquidHtml(fetcher.data.liquidHtml);
      if ("customCss" in fetcher.data) setCustomCss(fetcher.data.customCss);
      if (fetcher.data.intent === "load-starter") {
        setSourceType("code");
      } else if ("sourceType" in fetcher.data) {
        setSourceType(fetcher.data.sourceType as EditorSourceType);
      }
      applyingForm.current = false;
    }
  }, [fetcher.state, fetcher.data]);

  // Live preview (debounced) — Group 7 layout or Liquid path.
  useEffect(() => {
    if (!result || !config) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      const body = new FormData();
      body.set("intent", "preview");
      body.set("templateId", result.id);
      body.set("configJson", JSON.stringify(config));
      body.set(
        "sourceType",
        sourceType === "code"
          ? "code"
          : sourceType === "imported"
            ? "imported"
            : "layout",
      );
      body.set("liquidHtml", liquidHtml);
      body.set("customCss", customCss);
      previewFetcher.submit(body, { method: "post" });
    }, 400);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewFetcher identity changes each render
  }, [result?.id, config, liquidHtml, customCss, sourceType]);

  useEffect(() => {
    if (previewFetcher.state !== "idle" || !previewFetcher.data) return;
    if (previewFetcher.data.intent !== "preview") return;
    if (previewFetcher.data.ok && "html" in previewFetcher.data) {
      setPreviewHtml(previewFetcher.data.html);
    }
  }, [previewFetcher.state, previewFetcher.data]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !previewHtml) return;
    const onLoad = () => {
      const doc = iframe.contentDocument;
      const h = Math.max(
        doc?.body?.scrollHeight ?? 0,
        doc?.documentElement?.scrollHeight ?? 0,
        480,
      );
      iframe.style.height = `${h}px`;
    };
    iframe.addEventListener("load", onLoad);
    onLoad();
    return () => iframe.removeEventListener("load", onLoad);
  }, [previewHtml]);

  const onConfigChange = (next: TemplateConfig) => {
    if (applyingCode.current) {
      setConfig(next);
      return;
    }
    setConfig(next);
  };

  const onLiquidChange = (next: string) => {
    setLiquidHtml(next);
    if (applyingForm.current) return;
    if (sourceType === "layout") setSourceType("code");
    if (extractTimer.current) clearTimeout(extractTimer.current);
    extractTimer.current = setTimeout(() => {
      if (!config) return;
      applyingCode.current = true;
      const extracted = extractVisualConfigFromLiquid(next, config);
      setConfig(extracted);
      setSyncedConfig(structuredClone(extracted));
      applyingCode.current = false;
    }, 450);
  };

  if (!result || !config) {
    return (
      <s-page heading="Template not found" inlineSize="base">
        <SettingsTemplatesBreadcrumbs menuId="template-missing-breadcrumb" />
        <s-section accessibilityLabel="Template not found">
          <s-banner tone="critical" heading="Template not found">
            This template could not be loaded. It may have been deleted or does
            not belong to this store.
          </s-banner>
          <s-button variant="primary" href="/app/settings/templates">
            Back to templates
          </s-button>
        </s-section>
      </s-page>
    );
  }

  const listHref = `/app/settings/templates?type=${encodeURIComponent(result.documentType)}`;
  const isUntitled =
    isNew || searchParams.get("new") === "1";
  const pageHeading = isUntitled
    ? `New ${documentTypeTitle(result.documentType)} template`
    : result.name || "Untitled template";

  const submit = (intent: string, fields: Record<string, string> = {}) => {
    if (busy) return;
    dataAtSubmit.current = fetcher.data;
    awaiting.current = true;
    setSaveError(null);
    const body = new FormData();
    body.set("intent", intent);
    body.set("templateId", result.id);
    body.set("documentType", result.documentType);
    body.set("configJson", JSON.stringify(config));
    if (sourceType === "code" || sourceType === "layout") {
      body.set("sourceType", sourceType);
    }
    body.set("liquidHtml", liquidHtml);
    body.set("customCss", customCss);
    body.set("editorMode", editorView === "code" ? "code" : "visual");
    for (const [key, value] of Object.entries(fields)) {
      body.set(key, value);
    }
    fetcher.submit(body, { method: "post" });
  };

  const openSaveModal = () => {
    setSaveError(null);
    setSaveModalNameError(null);
    setCustomSaveMode("update");
    setSaveModalName(
      isUntitled ? "Untitled template" : `${result.name} copy`,
    );
    void shopify.modal.show(SAVE_MODAL_ID);
  };

  const closeSaveModal = () => {
    if (savingInModal) return;
    setSaveError(null);
    setSaveModalNameError(null);
    void shopify.modal.hide(SAVE_MODAL_ID);
  };

  const confirmSaveModal = () => {
    if (savingInModal || busy) return;
    const needsName =
      isUntitled ||
      result.isSystem ||
      customSaveMode === "save-as";
    if (needsName) {
      const err = validateTemplateName(saveModalName);
      setSaveModalNameError(err);
      if (err) return;
    }
    const trimmed = saveModalName.trim();
    setSavingInModal(true);
    setSaveError(null);
    if (isUntitled) {
      saveToastKind.current = "saved";
      submit("save", { name: trimmed });
      return;
    }
    if (result.isSystem || customSaveMode === "save-as") {
      saveToastKind.current = "saved";
      submit("save-as", { name: trimmed });
      return;
    }
    saveToastKind.current = "updated";
    submit("save", { name: result.name });
  };

  const refreshPreview = () => {
    if (!result || !config) return;
    const body = new FormData();
    body.set("intent", "preview");
    body.set("templateId", result.id);
    body.set("configJson", JSON.stringify(config));
    body.set(
      "sourceType",
      sourceType === "code"
        ? "code"
        : sourceType === "imported"
          ? "imported"
          : "layout",
    );
    body.set("liquidHtml", liquidHtml);
    body.set("customCss", customCss);
    previewFetcher.submit(body, { method: "post" });
  };

  const discardChanges = () => {
    if (!baselineConfig) return;
    syncEpochRef.current += 1;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    if (extractTimer.current) clearTimeout(extractTimer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    applyingCode.current = false;
    applyingForm.current = false;
    setName(baselineName);
    setConfig(structuredClone(baselineConfig));
    setSyncedConfig(structuredClone(baselineConfig));
    setLiquidHtml(baselineLiquid);
    setCustomCss(baselineCss);
    setSourceType(baselineSourceType);
    setLiquidValidation(null);
    setLogoResetToken((n) => n + 1);
    setSaveError(null);
    shopify.saveBar.hide(SAVE_BAR_ID);
  };

  const previewFailed =
    Boolean(previewFetcher.data) &&
    !previewFetcher.data?.ok &&
    previewFetcher.data?.intent === "preview";
  const previewErrorMessage =
    previewFailed && previewFetcher.data && "error" in previewFetcher.data
      ? previewFetcher.data.error
      : "Failed to render preview";

  const saveModalHeading = isUntitled
    ? "Name your template"
    : result.isSystem
      ? "Save as new template"
      : "Save template";
  const saveModalPrimaryLabel = isUntitled || result.isSystem
    ? "Save template"
    : "Save";

  return (
    <s-page heading={pageHeading} inlineSize="base">
      <SettingsTemplatesBreadcrumbs
        menuId="template-edit-breadcrumb"
        templatesHref={listHref}
      />
      {!isUntitled ? (
        <s-badge slot="accessory" tone="neutral">
          {result.isSystem ? "System" : "Custom"}
        </s-badge>
      ) : null}

      <ui-save-bar id={SAVE_BAR_ID}>
        <button
          variant="primary"
          onClick={openSaveModal}
          {...(busy || savingInModal ? { disabled: true } : {})}
        >
          Save
        </button>
        <button
          onClick={discardChanges}
          {...(busy || savingInModal ? { disabled: true } : {})}
        >
          Discard
        </button>
      </ui-save-bar>

      {result.isSystem ? (
        <s-banner
          slot="supplemental-start"
          tone="info"
          heading="System templates can't be edited"
        >
          When you save, your changes become a new template. The original stays
          as it is.
        </s-banner>
      ) : null}

      <s-section padding="base">
        <s-query-container>
          <s-grid
            gridTemplateColumns={EDITOR_LAYOUT_COLS}
            gap="large"
            alignItems="start"
          >
            <TemplateVisualConfigEditor
              config={config}
              onChange={onConfigChange}
              baseLayoutCode={result.baseLayoutCode}
              documentType={result.documentType}
              sourceType={sourceType}
              logoResetToken={logoResetToken}
            />

            <s-stack gap="base">
              {previewFailed ? (
                <s-banner tone="critical" heading="Preview failed">
                  <s-stack gap="base">
                    <s-text>{previewErrorMessage}</s-text>
                    <s-button
                      variant="secondary"
                      onClick={refreshPreview}
                      {...(previewing ? { loading: true, disabled: true } : {})}
                    >
                      Try again
                    </s-button>
                  </s-stack>
                </s-banner>
              ) : null}
              {previewing && !previewHtml ? (
                <s-spinner accessibilityLabel="Updating preview" />
              ) : null}
              {!previewFailed && previewHtml ? (
                <iframe
                  ref={iframeRef}
                  title="Template preview"
                  srcDoc={previewHtml}
                  sandbox="allow-same-origin allow-modals"
                  width="100%"
                />
              ) : null}
            </s-stack>
          </s-grid>
        </s-query-container>
      </s-section>

      <s-modal
        id={SAVE_MODAL_ID}
        heading={saveModalHeading}
        onHide={() => {
          if (savingInModal) {
            void shopify.modal.show(SAVE_MODAL_ID);
            return;
          }
          setSaveError(null);
          setSaveModalNameError(null);
        }}
      >
        <s-stack gap="base">
          {saveError ? (
            <s-banner tone="critical" heading="Couldn't save">
              {saveError}
            </s-banner>
          ) : null}

          {isUntitled ? (
            <s-text-field
              label="Template name"
              value={saveModalName}
              maxLength={TEMPLATE_NAME_MAX}
              {...(saveModalNameError ? { error: saveModalNameError } : {})}
              onInput={(event: Event) => {
                setSaveModalName(
                  (event.currentTarget as HTMLInputElement).value,
                );
                if (saveModalNameError) setSaveModalNameError(null);
              }}
            />
          ) : null}

          {result.isSystem && !isUntitled ? (
            <>
              <s-text>
                {result.name} can&apos;t be edited, so your changes will be
                saved as a new template.
              </s-text>
              <s-text-field
                label="Template name"
                value={saveModalName}
                maxLength={TEMPLATE_NAME_MAX}
                {...(saveModalNameError ? { error: saveModalNameError } : {})}
                onInput={(event: Event) => {
                  setSaveModalName(
                    (event.currentTarget as HTMLInputElement).value,
                  );
                  if (saveModalNameError) setSaveModalNameError(null);
                }}
              />
            </>
          ) : null}

          {!result.isSystem && !isUntitled ? (
            <>
              <s-choice-list
                label="How do you want to save?"
                name="custom-save-mode"
                values={[customSaveMode]}
                onChange={(event: Event) => {
                  const values = (
                    event.currentTarget as unknown as { values?: string[] }
                  ).values;
                  const next =
                    values?.[0] === "save-as" ? "save-as" : "update";
                  setCustomSaveMode(next);
                  setSaveModalNameError(null);
                  if (next === "save-as" && !saveModalName.trim()) {
                    setSaveModalName(`${result.name} copy`);
                  }
                }}
              >
                <s-choice value="update">
                  {`Update "${result.name}"`}
                  <s-text slot="details">Replace it with your changes.</s-text>
                </s-choice>
                <s-choice value="save-as">
                  Save as new template
                  <s-text slot="details">
                    Keep the original and create a copy.
                  </s-text>
                </s-choice>
              </s-choice-list>
              {customSaveMode === "save-as" ? (
                <s-text-field
                  label="Template name"
                  value={saveModalName}
                  maxLength={TEMPLATE_NAME_MAX}
                  {...(saveModalNameError
                    ? { error: saveModalNameError }
                    : {})}
                  onInput={(event: Event) => {
                    setSaveModalName(
                      (event.currentTarget as HTMLInputElement).value,
                    );
                    if (saveModalNameError) setSaveModalNameError(null);
                  }}
                />
              ) : null}
            </>
          ) : null}
        </s-stack>

        <s-button
          slot="primary-action"
          variant="primary"
          onClick={confirmSaveModal}
          {...(savingInModal ? { loading: true, disabled: true } : {})}
        >
          {saveModalPrimaryLabel}
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          onClick={closeSaveModal}
          {...(savingInModal ? { disabled: true } : {})}
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
