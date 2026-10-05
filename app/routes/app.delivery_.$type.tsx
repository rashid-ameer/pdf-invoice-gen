import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
        <s-link slot="breadcrumb-actions" href="/app/delivery">
          Email
        </s-link>
        <s-banner tone="critical" heading="Unknown template type">
          “{params.type || "missing"}” is not a valid email template. Choose a
          document type from the Email page.
        </s-banner>
        <s-stack direction="inline" gap="small">
          <s-button variant="primary" href="/app/delivery">
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

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline),
    [form, baseline],
  );

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

  return (
    <s-page heading={meta.title}>
      <s-link slot="breadcrumb-actions" href="/app/delivery">
        Email
      </s-link>

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

      <s-stack gap="base">
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
        {saveError ? (
          <s-banner tone="critical" heading="Couldn't save">
            {saveError}
          </s-banner>
        ) : null}

        <s-section heading="Template">
          <s-stack gap="base">
            <s-text-field
              label="Subject line"
              name="subject"
              value={form.subject}
              disabled={saving || undefined}
              onInput={(event: Event) => patch("subject", fieldValue(event))}
              onChange={(event: Event) => patch("subject", fieldValue(event))}
            />

            <s-stack gap="small">
              <s-text type="strong">Placeholders</s-text>
              <s-stack direction="inline" gap="small">
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

            {form.bodyMode === "designed" ? (
              <EmailBodyRichTextEditor
                ref={richTextRef}
                label="Message"
                value={form.body}
                disabled={saving}
                details="Rich text inside your branded email layout. Use placeholder chips above to insert fields."
                onChange={(html) => patch("body", html)}
              />
            ) : (
              <s-text-area
                label="Custom HTML"
                name="bodyCustom"
                value={form.bodyCustom}
                rows={14}
                details="Write your own HTML with {{placeholders}}. A full <html> document skips the branded wrapper."
                disabled={saving || undefined}
                onInput={(event: Event) =>
                  patch("bodyCustom", fieldValue(event))
                }
                onChange={(event: Event) =>
                  patch("bodyCustom", fieldValue(event))
                }
              />
            )}

            <s-checkbox
              label='Show "View document" button when a secure link is available'
              checked={form.showViewButton}
              disabled={saving || undefined}
              onChange={(event: Event) => {
                patch(
                  "showViewButton",
                  Boolean((event.currentTarget as HTMLInputElement).checked),
                );
              }}
            />

            <s-paragraph color="subdued">
              Secure link placeholders: view · print · download · 30-day expiry.
            </s-paragraph>

            <details>
              <summary>Advanced</summary>
              <s-box paddingBlockStart="base">
                <s-choice-list
                  label="Which template is sent?"
                  name="bodyMode"
                  values={[form.bodyMode]}
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
                    Designed: rich-text message wrapped in your branded layout
                  </s-choice>
                  <s-choice value="custom_html">
                    Custom HTML: your own HTML. Full HTML documents skip the
                    branded wrapper.
                  </s-choice>
                </s-choice-list>
              </s-box>
            </details>
          </s-stack>
        </s-section>
      </s-stack>

      <s-section
        slot="aside"
        heading="Live preview"
        subheading="Sample data. Updates as you edit."
      >
        <s-stack gap="base">
          {testError ? (
            <s-banner tone="critical" heading="Test email failed">
              {testError}
            </s-banner>
          ) : null}

          <s-box
            padding="none"
            border="base"
            borderRadius="base"
            overflow="hidden"
            background="base"
          >
            {previewHtml ? (
              <iframe
                title="Email preview"
                srcDoc={previewHtml}
                sandbox=""
                style={{
                  width: "100%",
                  minHeight: "360px",
                  border: "0",
                  display: "block",
                }}
              />
            ) : (
              <s-box padding="base">
                <s-text>
                  {previewing ? "Loading preview…" : "Preview unavailable"}
                </s-text>
              </s-box>
            )}
          </s-box>

          <s-paragraph color="subdued">
            Uses current edits · no PDF · not saved until you click Save
          </s-paragraph>

          <s-text-field
            label="Test recipient"
            name="testTo"
            value={testTo}
            placeholder="you@store.com"
            disabled={!emailConfigured || testing || undefined}
            onInput={(event: Event) => setTestTo(fieldValue(event))}
            onChange={(event: Event) => setTestTo(fieldValue(event))}
          />
          <s-button
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
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
