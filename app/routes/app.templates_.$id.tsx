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
import { LIQUID_VARIABLE_HELP } from "../models/template-liquid.defaults";
import { extractVisualConfigFromLiquid } from "../models/template-liquid-extract";
import { templateSourceKind } from "../models/template-liquid.server";
import { scheduleTemplateThumbnailRefresh } from "../models/template-thumbnail.server";
import { authenticate } from "../shopify.server";

const SAVE_BAR_ID = "template-visual-config-save-bar";
const MORE_MENU_ID = "template-details-more-actions";
const EDITOR_LAYOUT_COLS =
  "@container (inline-size > 900px) minmax(0, 1.1fr) minmax(0, 0.9fr), 1fr";

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

export default function TemplateDetailsPage() {
  const { result, isNew } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const previewFetcher = useFetcher<typeof action>();
  const syncFetcher = useFetcher<typeof action>();
  const validateFetcher = useFetcher<typeof action>();
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
  const [editorView, setEditorView] = useState<EditorView>("preview");
  const [liquidValidation, setLiquidValidation] = useState<LiquidCheck | null>(
    null,
  );
  const [logoResetToken, setLogoResetToken] = useState(0);
  const [saveAsName, setSaveAsName] = useState("");
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const awaiting = useRef(false);
  const dataAtSubmit = useRef(fetcher.data);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingCode = useRef(false);
  const applyingForm = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const liquidAreaRef = useRef<HTMLTextAreaElement | null>(null);

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
    setEditorView("preview");
  }, [result?.id]);

  useEffect(() => {
    if (!loadingDetails) return;
    shopify.loading(true);
    return () => {
      shopify.loading(false);
    };
  }, [loadingDetails, shopify]);

  useEffect(() => {
    if (!result || result.isSystem) {
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
      shopify.toast.show("Couldn't save", { isError: true });
      return;
    }

    if (!fetcher.data || fetcher.data === dataAtSubmit.current) {
      shopify.toast.show("Couldn't save", { isError: true });
      return;
    }

    if (!fetcher.data.ok) {
      const err =
        ("error" in fetcher.data && fetcher.data.error) || "Request failed";
      setSaveError(err);
      if ("validation" in fetcher.data && fetcher.data.validation) {
        setLiquidValidation(fetcher.data.validation as LiquidCheck);
      }
      shopify.toast.show(err, { isError: true });
      return;
    }

    setSaveError(null);
    setLiquidValidation(null);

    if (
      fetcher.data.intent === "save-as" &&
      "templateId" in fetcher.data &&
      fetcher.data.templateId
    ) {
      shopify.saveBar.hide(SAVE_BAR_ID);
      shopify.toast.show(fetcher.data.message);
      navigate(
        `/app/templates/${encodeURIComponent(fetcher.data.templateId)}?saved=1`,
      );
      return;
    }

    if (
      fetcher.data.intent === "customize" &&
      "templateId" in fetcher.data &&
      fetcher.data.templateId
    ) {
      shopify.toast.show(fetcher.data.message);
      navigate(
        `/app/templates/${encodeURIComponent(fetcher.data.templateId)}?new=1`,
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

    if (fetcher.data.intent === "save" && result && config) {
      setBaselineName(name.trim() || result.name);
      setBaselineConfig(structuredClone(config));
      setBaselineLiquid(liquidHtml);
      setBaselineCss(customCss);
      setBaselineSourceType(sourceType);
      setSyncedConfig(structuredClone(config));
      shopify.saveBar.hide(SAVE_BAR_ID);
    }

    shopify.toast.show(
      "message" in fetcher.data && fetcher.data.message
        ? fetcher.data.message
        : "Saved",
    );
    setShowSaveAs(false);
    setSaveAsName("");
  }, [
    fetcher.state,
    fetcher.data,
    navigate,
    shopify,
    result,
    config,
    name,
    liquidHtml,
    customCss,
    sourceType,
  ]);

  // Config → Liquid sync when editing code templates from the visual sidebar.
  useEffect(() => {
    if (!result || !config || !codeEditorAllowed) return;
    if (sourceType === "layout" || sourceType === "imported") return;
    if (applyingCode.current || applyingForm.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncFetcher identity churns
  }, [result?.id, config, sourceType, codeEditorAllowed]);

  useEffect(() => {
    if (syncFetcher.state !== "idle" || !syncFetcher.data) return;
    if (syncFetcher.data.intent !== "from-config" || !syncFetcher.data.ok) return;
    if (!("liquidHtml" in syncFetcher.data)) return;
    applyingForm.current = true;
    setLiquidHtml(syncFetcher.data.liquidHtml);
    if (config) setSyncedConfig(structuredClone(config));
    applyingForm.current = false;
  }, [syncFetcher.state, syncFetcher.data, config]);

  useEffect(() => {
    if (validateFetcher.state !== "idle" || !validateFetcher.data) return;
    if (validateFetcher.data.intent !== "validate") return;
    if (validateFetcher.data.ok && "validation" in validateFetcher.data) {
      setLiquidValidation(validateFetcher.data.validation as LiquidCheck);
      const errs = (validateFetcher.data.validation as LiquidCheck).errors;
      shopify.toast.show(
        errs.length ? "Liquid has issues to fix" : "Liquid looks valid",
        { isError: errs.length > 0 },
      );
    } else if (!validateFetcher.data.ok) {
      shopify.toast.show(
        ("error" in validateFetcher.data && validateFetcher.data.error) ||
          "Validation failed",
        { isError: true },
      );
    }
  }, [validateFetcher.state, validateFetcher.data, shopify]);

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
      setEditorView("code");
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
  const isUntitled =
    isNew || nameRequiredBlank || searchParams.get("new") === "1";

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

  const saveForm = () => {
    if (!name.trim()) {
      shopify.toast.show("Template name can't be blank.", { isError: true });
      return;
    }
    submit("save", { name });
  };

  const discardChanges = () => {
    if (!baselineConfig) return;
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

  const runValidate = () => {
    const body = new FormData();
    body.set("intent", "validate");
    body.set("templateId", result.id);
    body.set("liquidHtml", liquidHtml);
    validateFetcher.submit(body, { method: "post" });
  };

  const openCodeEditor = () => {
    if (!codeEditorAllowed) return;
    if (sourceType === "layout" && !liquidHtml.trim()) {
      const body = new FormData();
      body.set("intent", "load-source");
      body.set("templateId", result.id);
      fetcher.submit(body, { method: "post" });
      setSourceType("code");
    }
    setEditorView("code");
  };

  const loadStarter = () => {
    if (
      !window.confirm(
        "Replace the current HTML / Liquid with the default starter template for this document type? Style, Layout, Content, and Fields options are kept, but any custom code is overwritten.",
      )
    ) {
      return;
    }
    const body = new FormData();
    body.set("intent", "load-starter");
    body.set("templateId", result.id);
    fetcher.submit(body, { method: "post" });
  };

  const insertLiquidToken = (token: string) => {
    const area = liquidAreaRef.current;
    if (!area) {
      onLiquidChange(liquidHtml + token);
      return;
    }
    const start = area.selectionStart || 0;
    const end = area.selectionEnd || 0;
    const next =
      liquidHtml.slice(0, start) + token + liquidHtml.slice(end);
    onLiquidChange(next);
    requestAnimationFrame(() => {
      area.focus();
      const pos = start + token.length;
      area.setSelectionRange(pos, pos);
    });
  };

  return (
    <s-page heading={result.name || "Untitled template"} inlineSize="large">
      <s-link slot="breadcrumb-actions" href={listHref}>
        Templates
      </s-link>

      <ui-save-bar id={SAVE_BAR_ID}>
        <button
          variant="primary"
          onClick={saveForm}
          {...(busy ? { disabled: true, loading: true } : {})}
        >
          Save
        </button>
        <button
          onClick={discardChanges}
          {...(busy ? { disabled: true } : {})}
        >
          Discard
        </button>
      </ui-save-bar>

      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() =>
          result.isSystem ? submit("customize") : saveForm()
        }
        {...(busy
          ? { loading: true, disabled: true }
          : {})}
      >
        {result.isSystem ? "Customize" : "Save"}
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
          <s-button icon="check" onClick={() => submit("set-default")}>
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

      {saveError ? (
        <s-banner
          tone="critical"
          heading="Couldn't save"
          dismissible
          onDismiss={() => setSaveError(null)}
        >
          {saveError}
        </s-banner>
      ) : null}

      {result.isSystem ? (
        <s-banner tone="info" heading="System template">
          This template is read-only. Click Customize to create an editable copy
          under My templates.
        </s-banner>
      ) : null}

      <s-section heading="Template details">
        <s-stack gap="base">
          <s-text-field
            label="Name"
            value={name}
            maxLength={80}
            onInput={(event: Event) => {
              setName((event.currentTarget as HTMLInputElement).value);
            }}
            {...(result.isSystem ? { disabled: true } : {})}
          />
          <s-query-container>
            <s-grid
              gridTemplateColumns="@container (inline-size > 600px) repeat(3, 1fr), 1fr"
              gap="base"
            >
              <s-stack gap="none">
                <s-text color="subdued">Document type</s-text>
                <s-text>{documentTypeLabel(result.documentType)}</s-text>
              </s-stack>
              <s-stack gap="none">
                <s-text color="subdued">Layout</s-text>
                <s-text>{result.baseLayoutCode}</s-text>
              </s-stack>
              <s-stack gap="none">
                <s-text color="subdued">Default</s-text>
                <s-text>{result.isDefault ? "Yes" : "No"}</s-text>
              </s-stack>
            </s-grid>
          </s-query-container>
        </s-stack>
      </s-section>

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
            disabled={result.isSystem}
            logoResetToken={logoResetToken}
          />

          <s-section
            heading={editorView === "code" ? "Edit code" : "Preview"}
            subheading={
              editorView === "code"
                ? "HTML / Liquid · Extra CSS optional"
                : "Sample document · Group 7 renderer"
            }
          >
            <s-stack gap="base">
              <s-stack direction="inline" gap="small">
                {codeEditorAllowed ? (
                  <s-button
                    variant={editorView === "code" ? "primary" : "secondary"}
                    onClick={openCodeEditor}
                    {...(result.isSystem ? { disabled: true } : {})}
                  >
                    Edit code
                  </s-button>
                ) : null}
                <s-button
                  variant={editorView === "preview" ? "primary" : "secondary"}
                  onClick={() => setEditorView("preview")}
                >
                  Preview
                </s-button>
                {codeEditorAllowed && editorView === "code" ? (
                  <>
                    <s-button
                      variant="secondary"
                      onClick={runValidate}
                      {...(validateFetcher.state !== "idle"
                        ? { loading: true, disabled: true }
                        : result.isSystem
                          ? { disabled: true }
                          : {})}
                    >
                      Validate
                    </s-button>
                    <s-button
                      variant="secondary"
                      onClick={loadStarter}
                      {...(busy || result.isSystem ? { disabled: true } : {})}
                    >
                      Load starter
                    </s-button>
                  </>
                ) : null}
              </s-stack>

              {!codeEditorAllowed ? (
                <s-banner tone="info" heading="Fixed layout">
                  This layout keeps field positions fixed. Style, content, and
                  fields still apply. Code editing is not available.
                </s-banner>
              ) : null}

              {liquidValidation ? (
                <s-banner
                  tone={
                    liquidValidation.errors.length
                      ? "critical"
                      : liquidValidation.warnings.length
                        ? "warning"
                        : "success"
                  }
                  heading={
                    liquidValidation.errors.length
                      ? "Cannot save until these are fixed"
                      : liquidValidation.warnings.length
                        ? "Template parses. Recommended fields missing"
                        : "Template is valid"
                  }
                  dismissible
                  onDismiss={() => setLiquidValidation(null)}
                >
                  <s-stack gap="small">
                    {liquidValidation.checks.map((check) => (
                      <s-text key={check.id}>
                        {check.ok ? "✓" : check.level === "error" ? "✗" : "!"}{" "}
                        {check.label}
                        {!check.ok
                          ? check.level === "error"
                            ? " (required)"
                            : " (recommended)"
                          : ""}
                      </s-text>
                    ))}
                    {liquidValidation.errors.concat(liquidValidation.warnings).map(
                      (msg) => (
                        <s-text key={msg}>{msg}</s-text>
                      ),
                    )}
                  </s-stack>
                </s-banner>
              ) : null}

              {editorView === "code" && codeEditorAllowed ? (
                <s-stack gap="base">
                  <s-stack direction="inline" gap="small">
                    {LIQUID_VARIABLE_HELP.map((item) => (
                      <s-button
                        key={item.token}
                        variant="tertiary"
                        onClick={() => insertLiquidToken(item.token)}
                        {...(result.isSystem ? { disabled: true } : {})}
                      >
                        {item.token}
                      </s-button>
                    ))}
                  </s-stack>
                  <s-text-area
                    label="HTML / Liquid"
                    value={liquidHtml}
                    rows={18}
                    details="Validated with the same rules as the old template editor."
                    {...(result.isSystem ? { disabled: true } : {})}
                    onInput={(event: Event) => {
                      const target = event.currentTarget as HTMLTextAreaElement;
                      liquidAreaRef.current = target;
                      onLiquidChange(target.value ?? "");
                    }}
                    onChange={(event: Event) => {
                      const target = event.currentTarget as HTMLTextAreaElement;
                      liquidAreaRef.current = target;
                      onLiquidChange(target.value ?? "");
                    }}
                  />
                  <s-text-area
                    label="Extra CSS (optional)"
                    value={customCss}
                    rows={4}
                    {...(result.isSystem ? { disabled: true } : {})}
                    onInput={(event: Event) => {
                      setCustomCss(
                        (event.currentTarget as HTMLTextAreaElement).value ??
                          "",
                      );
                      if (sourceType === "layout") setSourceType("code");
                    }}
                  />
                </s-stack>
              ) : (
                <s-stack gap="base">
                  {previewing && !previewHtml ? (
                    <s-spinner accessibilityLabel="Updating preview" />
                  ) : null}
                  {previewFetcher.data &&
                  !previewFetcher.data.ok &&
                  previewFetcher.data.intent === "preview" ? (
                    <s-banner tone="critical" heading="Preview failed">
                      {"error" in previewFetcher.data
                        ? previewFetcher.data.error
                        : "Failed to render preview"}
                    </s-banner>
                  ) : null}
                  <s-box
                    border="base"
                    borderRadius="base"
                    overflow="hidden"
                    background="subdued"
                  >
                    <iframe
                      ref={iframeRef}
                      title="Template preview"
                      srcDoc={previewHtml || undefined}
                      sandbox="allow-same-origin allow-modals"
                      style={{
                        width: "100%",
                        minHeight: 480,
                        border: 0,
                        background: "transparent",
                        display: "block",
                      }}
                    />
                  </s-box>
                  <s-text color="subdued">
                    {sourceType === "code" || sourceType === "imported"
                      ? "Preview uses the Liquid / custom HTML path through Group 7."
                      : "Preview uses the layout renderer. Store Branding is applied when documents are generated."}
                  </s-text>
                </s-stack>
              )}
            </s-stack>
          </s-section>
        </s-grid>
      </s-query-container>

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
