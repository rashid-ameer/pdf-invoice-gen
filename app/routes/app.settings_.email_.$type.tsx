import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useParams,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  EmailBodyRichTextEditor,
  type EmailBodyRichTextEditorHandle,
} from "../components/email-body-rich-text-editor";
import { SettingsEmailBreadcrumbs } from "../components/settings-email-breadcrumbs";
import {
  getDeliverySettings,
  isEmailProviderConfigured,
  normalizeDeliverySettings,
  previewDocumentEmail,
  saveDeliverySettings,
  sendDocumentTestEmail,
  type DeliverySettings,
} from "../models/document-email.server";
import type {
  EmailBodyMode,
  EmailDocumentKind,
} from "../models/email-template.server";
import { authenticate } from "../shopify.server";

/**
 * Edit email template content for one document type.
 * showViewButton is store-wide (shared across all email types).
 */

const SAVE_BAR_ID = "email-template-save-bar";

const TYPE_META = {
  invoice: {
    kind: "invoice" as EmailDocumentKind,
    title: "Tax invoice email",
    linkPlaceholder: "{{invoice_link}}",
  },
  "credit-note": {
    kind: "credit_note" as EmailDocumentKind,
    title: "Credit note email",
    linkPlaceholder: "{{credit_note_link}}",
  },
  refund: {
    kind: "refund" as EmailDocumentKind,
    title: "Refund document email",
    linkPlaceholder: "{{refund_link}}",
  },
} as const;

type UrlType = keyof typeof TYPE_META;

type TemplateForm = {
  subject: string;
  bodyMode: EmailBodyMode;
  body: string;
  bodyCustom: string;
  showViewButton: boolean;
};

type ActionResult =
  | { ok: true; intent: "save"; settings: DeliverySettings; message: string }
  | { ok: false; intent: "save"; error: string }
  | { ok: true; intent: "preview"; html: string; text: string }
  | { ok: false; intent: "preview"; error: string }
  | { ok: true; intent: "test"; message: string }
  | { ok: false; intent: "test"; error: string };

const FIELD_PLACEHOLDERS = [
  "{{invoice_number}}",
  "{{credit_note_number}}",
  "{{order_number}}",
  "{{shop_name}}",
  "{{customer_name}}",
] as const;

/** 3:2 visual editor (left form / right preview); collapses on narrow containers. */
const EDITOR_LAYOUT_COLS =
  "@container (inline-size > 768px) 3fr 2fr, 1fr";

function isUrlType(value: string | undefined): value is UrlType {
  return Boolean(value && value in TYPE_META);
}

function fieldValue(event: Event): string {
  return String((event.currentTarget as HTMLInputElement | null)?.value ?? "");
}

function appendPlaceholder(current: string, placeholder: string): string {
  if (!current) return placeholder;
  const needsSpace = !/\s$/.test(current);
  return `${current}${needsSpace ? " " : ""}${placeholder}`;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function checkboxOn(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "1" || value === "on" || value === "true";
}

function templateFormFromSettings(
  settings: DeliverySettings,
  kind: EmailDocumentKind,
): TemplateForm {
  if (kind === "credit_note") {
    return {
      subject: settings.creditNoteSubject,
      bodyMode: settings.creditNoteBodyMode,
      body: settings.creditNoteBody,
      bodyCustom: settings.creditNoteBodyCustom,
      showViewButton: settings.showViewButton,
    };
  }
  if (kind === "refund") {
    return {
      subject: settings.refundSubject,
      bodyMode: settings.refundBodyMode,
      body: settings.refundBody,
      bodyCustom: settings.refundBodyCustom,
      showViewButton: settings.showViewButton,
    };
  }
  return {
    subject: settings.invoiceSubject,
    bodyMode: settings.invoiceBodyMode,
    body: settings.invoiceBody,
    bodyCustom: settings.invoiceBodyCustom,
    showViewButton: settings.showViewButton,
  };
}

function partialFromTemplateForm(
  kind: EmailDocumentKind,
  form: TemplateForm,
): Partial<DeliverySettings> {
  if (kind === "credit_note") {
    return {
      creditNoteSubject: form.subject,
      creditNoteBodyMode: form.bodyMode,
      creditNoteBody: form.body,
      creditNoteBodyCustom: form.bodyCustom,
      showViewButton: form.showViewButton,
    };
  }
  if (kind === "refund") {
    return {
      refundSubject: form.subject,
      refundBodyMode: form.bodyMode,
      refundBody: form.body,
      refundBodyCustom: form.bodyCustom,
      showViewButton: form.showViewButton,
    };
  }
  return {
    invoiceSubject: form.subject,
    invoiceBodyMode: form.bodyMode,
    invoiceBody: form.body,
    invoiceBodyCustom: form.bodyCustom,
    showViewButton: form.showViewButton,
  };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const typeParam = params.type;
  if (!isUrlType(typeParam)) {
    return {
      invalidType: true as const,
      settings: null,
      emailConfigured: false,
      type: null,
    };
  }

  const settings = await getDeliverySettings(session.shop);
  if (!settings) {
    throw new Response("Store not found. Please reinstall the app.", {
      status: 404,
    });
  }

  return {
    invalidType: false as const,
    settings,
    emailConfigured: isEmailProviderConfigured(),
    type: typeParam,
  };
};

export const action = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const typeParam = params.type;
  if (!isUrlType(typeParam)) {
    return { ok: false, intent: "save", error: "Unknown email template type" };
  }
  const meta = TYPE_META[typeParam];
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");

  const form: TemplateForm = {
    subject: readString(formData, "subject"),
    bodyMode:
      readString(formData, "bodyMode") === "custom_html"
        ? "custom_html"
        : "designed",
    body: readString(formData, "body"),
    bodyCustom: readString(formData, "bodyCustom"),
    showViewButton: checkboxOn(formData, "showViewButton"),
  };

  const draft = normalizeDeliverySettings({
    ...(await getDeliverySettings(session.shop)),
    ...partialFromTemplateForm(meta.kind, form),
  });

  if (intent === "preview") {
    try {
      const preview = await previewDocumentEmail({
        shop: session.shop,
        settings: draft,
        documentKind: meta.kind,
      });
      return {
        ok: true,
        intent: "preview",
        html: preview.html,
        text: preview.text,
      };
    } catch (error) {
      console.error("[email-template] preview error:", error);
      return {
        ok: false,
        intent: "preview",
        error: "Failed to render email preview",
      };
    }
  }

  if (intent === "test") {
    if (!isEmailProviderConfigured()) {
      return {
        ok: false,
        intent: "test",
        error: "Email is not configured on the server.",
      };
    }
    if (!form.subject) {
      return { ok: false, intent: "test", error: "Subject line is empty" };
    }
    const to = readString(formData, "testTo");
    const result = await sendDocumentTestEmail({
      shop: session.shop,
      to,
      documentKind: meta.kind,
      settings: draft,
      bodyMode: form.bodyMode,
      bodyTemplate: form.body,
      customBodyTemplate: form.bodyCustom,
      subjectTemplate: form.subject,
    });
    if (!result.ok) {
      return {
        ok: false,
        intent: "test",
        error: result.error || "Test send failed",
      };
    }
    return {
      ok: true,
      intent: "test",
      message: "Test email sent",
    };
  }

  if (!form.subject) {
    return { ok: false, intent: "save", error: "Subject line is required." };
  }

  const saved = await saveDeliverySettings(
    session.shop,
    partialFromTemplateForm(meta.kind, form),
  );
  if (!saved) {
    return { ok: false, intent: "save", error: "Store not found" };
  }
  return {
    ok: true,
    intent: "save",
    settings: saved,
    message: "Email template saved",
  };
};

export default function EmailTemplatePage() {
  const loaderData = useLoaderData<typeof loader>();
  const params = useParams();

  if (loaderData.invalidType || !loaderData.type || !loaderData.settings) {
    return (
      <s-page heading="Email template">
        <SettingsEmailBreadcrumbs menuId="email-template-invalid-breadcrumb" />
        <s-banner tone="critical" heading="Unknown template type">
          “{params.type || "missing"}” is not a valid email template. Choose a
          document type from the Email page.
        </s-banner>
        <s-stack direction="inline" gap="small">
          <s-button variant="primary" href="/app/settings/email">
            Back to Email
          </s-button>
        </s-stack>
      </s-page>
    );
  }

  return (
    <EmailTemplateEditor
      type={loaderData.type}
      settings={loaderData.settings}
      emailConfigured={loaderData.emailConfigured}
    />
  );
}

function EmailTemplateEditor({
  type,
  settings,
  emailConfigured,
}: {
  type: UrlType;
  settings: DeliverySettings;
  emailConfigured: boolean;
}) {
  const saveFetcher = useFetcher<ActionResult>();
  const previewFetcher = useFetcher<ActionResult>();
  const testFetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();

  const meta = TYPE_META[type];
  const serverSettings =
    saveFetcher.data &&
    saveFetcher.data.ok &&
    saveFetcher.data.intent === "save"
      ? saveFetcher.data.settings
      : settings;
  const initialForm = templateFormFromSettings(serverSettings, meta.kind);
  const serverKey = JSON.stringify(initialForm);

  const [baseline, setBaseline] = useState<TemplateForm>(initialForm);
  const [form, setForm] = useState<TemplateForm>(initialForm);
  const [previewHtml, setPreviewHtml] = useState("");
  const [connectionError, setConnectionError] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [testError, setTestError] = useState("");
  const [testTo, setTestTo] = useState(() => serverSettings.replyTo || "");
  const richTextRef = useRef<EmailBodyRichTextEditorHandle | null>(null);

  const awaitingSave = useRef(false);
  const dataAtSubmit = useRef(saveFetcher.data);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saving =
    saveFetcher.state === "submitting" || saveFetcher.state === "loading";
  const testing =
    testFetcher.state === "submitting" || testFetcher.state === "loading";
  const previewing =
    previewFetcher.state === "submitting" || previewFetcher.state === "loading";

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline),
    [form, baseline],
  );

  useEffect(() => {
    const next = templateFormFromSettings(serverSettings, meta.kind);
    setForm(next);
    setBaseline(next);
    setSaveError("");
    setTestTo((prev) => prev || serverSettings.replyTo || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey, meta.kind]);

  useEffect(() => {
    if (!awaitingSave.current || saveFetcher.state !== "idle") return;
    awaitingSave.current = false;

    if (!saveFetcher.data || saveFetcher.data === dataAtSubmit.current) {
      setConnectionError(true);
      setSaveError("");
      shopify.toast.show("Couldn't save", { isError: true });
      return;
    }

    setConnectionError(false);
    if (saveFetcher.data.ok && saveFetcher.data.intent === "save") {
      setSaveError("");
      shopify.toast.show(saveFetcher.data.message);
      shopify.saveBar.hide(SAVE_BAR_ID);
      return;
    }
    if (!saveFetcher.data.ok && saveFetcher.data.intent === "save") {
      setSaveError(saveFetcher.data.error);
      shopify.toast.show(saveFetcher.data.error, { isError: true });
    }
  }, [saveFetcher.data, saveFetcher.state, shopify]);

  useEffect(() => {
    if (testFetcher.state !== "idle" || !testFetcher.data) return;
    if (testFetcher.data.intent !== "test") return;
    if (testFetcher.data.ok) {
      setTestError("");
      shopify.toast.show(testFetcher.data.message);
    } else {
      setTestError(testFetcher.data.error);
      shopify.toast.show(testFetcher.data.error, { isError: true });
    }
  }, [testFetcher.state, testFetcher.data, shopify]);

  useEffect(() => {
    if (previewFetcher.state !== "idle" || !previewFetcher.data) return;
    if (previewFetcher.data.intent !== "preview") return;
    if (previewFetcher.data.ok) {
      setPreviewHtml(previewFetcher.data.html);
    }
  }, [previewFetcher.state, previewFetcher.data]);

  useEffect(() => {
    shopify.loading(saving || testing);
    return () => {
      shopify.loading(false);
    };
  }, [saving, testing, shopify]);

  useEffect(() => {
    if (dirty) shopify.saveBar.show(SAVE_BAR_ID);
    else shopify.saveBar.hide(SAVE_BAR_ID);
    return () => {
      shopify.saveBar.hide(SAVE_BAR_ID);
    };
  }, [dirty, shopify]);

  const patch = useCallback(<K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const insertPlaceholder = (placeholder: string) => {
    if (form.bodyMode === "custom_html") {
      patch("bodyCustom", appendPlaceholder(form.bodyCustom, placeholder));
      return;
    }
    richTextRef.current?.insertPlaceholder(placeholder);
  };

  const buildFormData = (intent: string) => {
    const body = new FormData();
    body.set("intent", intent);
    body.set("subject", form.subject);
    body.set("bodyMode", form.bodyMode);
    body.set("body", form.body);
    body.set("bodyCustom", form.bodyCustom);
    body.set("showViewButton", form.showViewButton ? "1" : "0");
    return body;
  };

  const schedulePreview = useCallback(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      previewFetcher.submit(buildFormData("preview"), { method: "post" });
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  useEffect(() => {
    schedulePreview();
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [schedulePreview]);

  const discardChanges = () => {
    if (saving) return;
    setForm(baseline);
    setSaveError("");
    setConnectionError(false);
    shopify.saveBar.hide(SAVE_BAR_ID);
  };

  const saveForm = () => {
    if (saving) return;
    dataAtSubmit.current = saveFetcher.data;
    awaitingSave.current = true;
    saveFetcher.submit(buildFormData("save"), { method: "post" });
  };

  const sendTest = () => {
    if (testing || !emailConfigured) return;
    setTestError("");
    const body = buildFormData("test");
    body.set("testTo", testTo.trim());
    testFetcher.submit(body, { method: "post" });
  };

  const placeholders = [...FIELD_PLACEHOLDERS, meta.linkPlaceholder];
  const subjectError = saveError.toLowerCase().includes("subject")
    ? saveError
    : "";
  const bannerSaveError = subjectError ? "" : saveError;
  const templateLabel =
    form.bodyMode === "custom_html" ? "Custom HTML" : "Designed";

  const placeholderChips = (
    <s-stack gap="small-100">
      <s-stack gap="none">
        <s-text type="strong">Placeholders</s-text>
        <s-paragraph color="subdued">
          Click a placeholder to insert it into the message.
        </s-paragraph>
      </s-stack>
      <s-stack direction="inline" gap="small-200">
        {placeholders.map((ph) => (
          <s-clickable-chip
            key={ph}
            accessibilityLabel={`Insert ${ph}`}
            onClick={() => insertPlaceholder(ph)}
          >
            {ph}
          </s-clickable-chip>
        ))}
      </s-stack>
    </s-stack>
  );

  return (
    <s-page heading={meta.title} inlineSize="large">
      <SettingsEmailBreadcrumbs menuId="email-template-edit-breadcrumb" />

      <ui-save-bar id={SAVE_BAR_ID}>
        <button
          variant="primary"
          onClick={saveForm}
          {...(saving ? { disabled: true, loading: true } : {})}
        >
          Save
        </button>
        <button
          onClick={discardChanges}
          {...(saving ? { disabled: true } : {})}
        >
          Discard
        </button>
      </ui-save-bar>

      {connectionError ? (
        <s-banner
          tone="critical"
          heading="Couldn't save"
          dismissible
          onDismiss={() => setConnectionError(false)}
        >
          Check your connection and try again.
        </s-banner>
      ) : null}
      {bannerSaveError ? (
        <s-banner tone="critical" heading="Couldn't save">
          {bannerSaveError}
        </s-banner>
      ) : null}

      <s-query-container>
        <s-grid
          gridTemplateColumns={EDITOR_LAYOUT_COLS}
          gap="base"
          alignItems="start"
        >
            <s-stack gap="base">
              <s-section heading="Email template">
                <s-choice-list
                  label="Which template is sent?"
                  name="bodyMode"
                  values={[form.bodyMode]}
                  disabled={saving || undefined}
                  onChange={(event: Event) => {
                    const values = (
                      event.currentTarget as unknown as { values?: string[] }
                    ).values;
                    patch(
                      "bodyMode",
                      values?.[0] === "custom_html"
                        ? "custom_html"
                        : "designed",
                    );
                  }}
                >
                  <s-choice value="designed">
                    Designed
                    <s-text slot="details">
                      Write the message and we wrap it in your branded layout.
                    </s-text>
                  </s-choice>
                  <s-choice value="custom_html">
                    Custom HTML
                    <s-text slot="details">
                      Write the full email in HTML. Full HTML documents skip
                      the branded wrapper.
                    </s-text>
                  </s-choice>
                </s-choice-list>
              </s-section>

              {form.bodyMode === "designed" ? (
                <s-section heading="Message">
                  <s-stack gap="base">
                    <s-text-field
                      label="Subject"
                      name="subject"
                      value={form.subject}
                      error={subjectError || undefined}
                      disabled={saving || undefined}
                      onInput={(event: Event) =>
                        patch("subject", fieldValue(event))
                      }
                      onChange={(event: Event) =>
                        patch("subject", fieldValue(event))
                      }
                    />

                    {placeholderChips}

                    <EmailBodyRichTextEditor
                      ref={richTextRef}
                      label="Message"
                      value={form.body}
                      disabled={saving}
                      onChange={(html) => patch("body", html)}
                    />

                    <s-checkbox
                      label='Show "View document" button'
                      details="Appears when a secure link is available. Links expire after 30 days."
                      checked={form.showViewButton}
                      disabled={saving || undefined}
                      onChange={(event: Event) => {
                        patch(
                          "showViewButton",
                          Boolean(
                            (event.currentTarget as HTMLInputElement).checked,
                          ),
                        );
                      }}
                    />
                  </s-stack>
                </s-section>
              ) : (
                <s-section heading="Custom HTML">
                  <s-stack gap="base">
                    <s-banner
                      tone="warning"
                      heading="Your HTML is sent as written"
                    >
                      Full HTML documents are sent without the branded wrapper.
                      Add {meta.linkPlaceholder} yourself if you want a
                      document link.
                    </s-banner>

                    <s-text-field
                      label="Subject"
                      name="subject"
                      value={form.subject}
                      error={subjectError || undefined}
                      disabled={saving || undefined}
                      onInput={(event: Event) =>
                        patch("subject", fieldValue(event))
                      }
                      onChange={(event: Event) =>
                        patch("subject", fieldValue(event))
                      }
                    />

                    {placeholderChips}

                    <s-text-area
                      label="HTML"
                      name="bodyCustom"
                      value={form.bodyCustom}
                      rows={14}
                      disabled={saving || undefined}
                      onInput={(event: Event) =>
                        patch("bodyCustom", fieldValue(event))
                      }
                      onChange={(event: Event) =>
                        patch("bodyCustom", fieldValue(event))
                      }
                    />
                  </s-stack>
                </s-section>
              )}
            </s-stack>

            <s-stack gap="base" minInlineSize="0" overflow="hidden">
              <s-section heading="Live preview">
                <s-stack gap="base">
                  <s-badge>{templateLabel}</s-badge>
                  <EmailLivePreviewFrame
                    html={previewHtml}
                    previewing={previewing}
                  />
                </s-stack>
              </s-section>

              <s-section heading="Send a test">
                <s-stack gap="base">
                  <s-email-field
                    label="Test recipient"
                    value={testTo}
                    details="Sends your current edits without a PDF."
                    error={testError || undefined}
                    disabled={!emailConfigured || testing || undefined}
                    autocomplete="off"
                    onInput={(event: Event) => setTestTo(fieldValue(event))}
                    onChange={(event: Event) => setTestTo(fieldValue(event))}
                  />
                  <s-button
                    type="button"
                    variant="secondary"
                    onClick={sendTest}
                    {...(testing || !emailConfigured
                      ? { loading: testing || undefined, disabled: true }
                      : {})}
                  >
                    Send test
                  </s-button>
                </s-stack>
              </s-section>
            </s-stack>
          </s-grid>
        </s-query-container>
    </s-page>
  );
}

/**
 * Full-width email preview: iframe fills the card and grows to the email height
 * so the page has a single scrollbar (no inner iframe scroll).
 */
function EmailLivePreviewFrame({
  html,
  previewing,
}: {
  html: string;
  previewing: boolean;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const fitPreview = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument;
    const contentHeight = Math.max(
      doc?.body?.scrollHeight ?? 0,
      doc?.documentElement?.scrollHeight ?? 0,
      240,
    );

    iframe.style.width = "100%";
    iframe.style.height = `${contentHeight}px`;
    iframe.style.border = "0";
    iframe.style.display = "block";
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitPreview());
    observer.observe(shell);
    return () => observer.disconnect();
  }, [fitPreview]);

  useEffect(() => {
    fitPreview();
  }, [html, fitPreview]);

  return (
    <s-box
      padding="none"
      background="subdued"
      borderRadius="base"
      borderWidth="base"
      overflow="hidden"
      minInlineSize="0"
    >
      {html ? (
        <div ref={shellRef} style={{ width: "100%", minWidth: 0 }}>
          <iframe
            ref={iframeRef}
            title="Email preview"
            srcDoc={html}
            sandbox="allow-same-origin"
            onLoad={fitPreview}
            style={{ width: "100%", border: 0, display: "block", minHeight: 240 }}
          />
        </div>
      ) : (
        <s-box padding="base">
          <s-text>
            {previewing ? "Loading preview…" : "Preview unavailable"}
          </s-text>
        </s-box>
      )}
    </s-box>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
