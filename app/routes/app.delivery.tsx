import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

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
  EmailLayout,
} from "../models/email-template.server";
import { authenticate } from "../shopify.server";

/**
 * Group 12 Phase 2 — Email / Delivery settings (old `/app/delivery`).
 * Nav label: Email. Saves via Shopify save bar like Branding / Company setup.
 * No Quill — designed body uses s-text-area (HTML content from Phase 1).
 */

const SAVE_BAR_ID = "delivery-save-bar";
const GRID_MAIN_ASIDE =
  '@container (inline-size > 900px) "minmax(0, 1fr) 320px", 1fr';

type TemplateKind = EmailDocumentKind;

type DeliveryForm = DeliverySettings;

type ActionResult =
  | { ok: true; intent: "save"; settings: DeliverySettings; message: string }
  | { ok: false; intent: "save"; error: string }
  | { ok: true; intent: "preview"; html: string; text: string }
  | { ok: false; intent: "preview"; error: string }
  | {
      ok: true;
      intent: "test";
      to: string;
      message: string;
    }
  | { ok: false; intent: "test"; error: string };

function checkboxOn(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "1" || value === "on" || value === "true";
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function settingsFromFormData(formData: FormData): Partial<DeliverySettings> {
  const invoiceWhenRaw = readString(formData, "invoiceWhen");
  return {
    enabled: checkboxOn(formData, "enabled"),
    invoiceAutoSend: checkboxOn(formData, "invoiceAutoSend"),
    invoiceWhen: invoiceWhenRaw === "created" ? "created" : "paid",
    creditNoteAutoSend: checkboxOn(formData, "creditNoteAutoSend"),
    refundDocumentAutoSend: checkboxOn(formData, "refundDocumentAutoSend"),
    ccStaff: readString(formData, "ccStaff"),
    fromName: readString(formData, "fromName"),
    replyTo: readString(formData, "replyTo"),
    emailLayout: (readString(formData, "emailLayout") ||
      "classic") as EmailLayout,
    showViewButton: checkboxOn(formData, "showViewButton"),
    invoiceBodyMode: (readString(formData, "invoiceBodyMode") ||
      "designed") as EmailBodyMode,
    invoiceSubject: readString(formData, "invoiceSubject"),
    invoiceBody: readString(formData, "invoiceBody"),
    invoiceBodyCustom: readString(formData, "invoiceBodyCustom"),
    creditNoteBodyMode: (readString(formData, "creditNoteBodyMode") ||
      "designed") as EmailBodyMode,
    creditNoteSubject: readString(formData, "creditNoteSubject"),
    creditNoteBody: readString(formData, "creditNoteBody"),
    creditNoteBodyCustom: readString(formData, "creditNoteBodyCustom"),
    refundBodyMode: (readString(formData, "refundBodyMode") ||
      "designed") as EmailBodyMode,
    refundSubject: readString(formData, "refundSubject"),
    refundBody: readString(formData, "refundBody"),
    refundBodyCustom: readString(formData, "refundBodyCustom"),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getDeliverySettings(session.shop);
  if (!settings) {
    throw new Response("Store not found. Please reinstall the app.", {
      status: 404,
    });
  }

  const emailFrom = process.env.EMAIL_FROM ?? "";
  return {
    settings,
    emailConfigured: isEmailProviderConfigured(),
    emailFrom,
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");

  if (intent === "preview") {
    const draft = normalizeDeliverySettings(settingsFromFormData(formData));
    const documentKind = (readString(formData, "documentKind") ||
      "invoice") as EmailDocumentKind;
    try {
      const preview = await previewDocumentEmail({
        shop: session.shop,
        settings: draft,
        documentKind,
      });
      return { ok: true, intent: "preview", html: preview.html, text: preview.text };
    } catch (error) {
      console.error("[delivery] preview error:", error);
      return { ok: false, intent: "preview", error: "Failed to render email preview" };
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
    const draft = normalizeDeliverySettings(settingsFromFormData(formData));
    const documentKind = (readString(formData, "documentKind") ||
      "invoice") as EmailDocumentKind;
    const to = readString(formData, "testTo");
    const fields =
      documentKind === "credit_note"
        ? {
            subject: draft.creditNoteSubject,
            bodyMode: draft.creditNoteBodyMode,
            body: draft.creditNoteBody,
            custom: draft.creditNoteBodyCustom,
          }
        : documentKind === "refund"
          ? {
              subject: draft.refundSubject,
              bodyMode: draft.refundBodyMode,
              body: draft.refundBody,
              custom: draft.refundBodyCustom,
            }
          : {
              subject: draft.invoiceSubject,
              bodyMode: draft.invoiceBodyMode,
              body: draft.invoiceBody,
              custom: draft.invoiceBodyCustom,
            };

    if (!fields.subject) {
      return { ok: false, intent: "test", error: "Subject line is empty" };
    }

    const result = await sendDocumentTestEmail({
      shop: session.shop,
      to,
      documentKind,
      settings: draft,
      bodyMode: fields.bodyMode,
      bodyTemplate: fields.body,
      customBodyTemplate: fields.custom,
      subjectTemplate: fields.subject,
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
      to: result.to || to,
      message: `Test email sent to ${result.to || to}`,
    };
  }

  const partial = settingsFromFormData(formData);
  const replyTo = partial.replyTo ?? "";
  if (replyTo && !replyTo.includes("@")) {
    return {
      ok: false,
      intent: "save",
      error: "Enter a valid reply-to email address.",
    };
  }

  const saved = await saveDeliverySettings(session.shop, partial);
  if (!saved) {
    return { ok: false, intent: "save", error: "Store not found" };
  }
  return {
    ok: true,
    intent: "save",
    settings: saved,
    message: "Email settings saved",
  };
};

function fieldValue(event: Event): string {
  return String((event.currentTarget as HTMLInputElement | null)?.value ?? "");
}

function appendPlaceholder(
  current: string,
  placeholder: string,
): string {
  if (!current) return placeholder;
  const needsSpace = !/\s$/.test(current);
  return `${current}${needsSpace ? " " : ""}${placeholder}`;
}

export default function DeliveryPage() {
  const loaderData = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<ActionResult>();
  const previewFetcher = useFetcher<ActionResult>();
  const testFetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();

  const serverSettings =
    saveFetcher.data &&
    saveFetcher.data.ok &&
    saveFetcher.data.intent === "save"
      ? saveFetcher.data.settings
      : loaderData.settings;
  const serverKey = JSON.stringify(serverSettings);

  const [baseline, setBaseline] = useState<DeliveryForm>(serverSettings);
  const [form, setForm] = useState<DeliveryForm>(serverSettings);
  const [templateKind, setTemplateKind] = useState<TemplateKind>("invoice");
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [connectionError, setConnectionError] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [testTo, setTestTo] = useState(
    () => serverSettings.replyTo || "",
  );

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
    setForm(serverSettings);
    setBaseline(serverSettings);
    setTestTo((prev) => prev || serverSettings.replyTo || "");
    setSaveError("");
    // Sync when server payload changes (load / save).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

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
      shopify.toast.show(testFetcher.data.message);
    } else {
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

  const patch = useCallback(<K extends keyof DeliveryForm>(key: K, value: DeliveryForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const appendToActiveBody = (placeholder: string) => {
    if (templateKind === "invoice") {
      if (form.invoiceBodyMode === "custom_html") {
        patch("invoiceBodyCustom", appendPlaceholder(form.invoiceBodyCustom, placeholder));
      } else {
        patch("invoiceBody", appendPlaceholder(form.invoiceBody, placeholder));
      }
      return;
    }
    if (templateKind === "credit_note") {
      if (form.creditNoteBodyMode === "custom_html") {
        patch(
          "creditNoteBodyCustom",
          appendPlaceholder(form.creditNoteBodyCustom, placeholder),
        );
      } else {
        patch("creditNoteBody", appendPlaceholder(form.creditNoteBody, placeholder));
      }
      return;
    }
    if (form.refundBodyMode === "custom_html") {
      patch("refundBodyCustom", appendPlaceholder(form.refundBodyCustom, placeholder));
    } else {
      patch("refundBody", appendPlaceholder(form.refundBody, placeholder));
    }
  };

  const buildFormData = (intent: string) => {
    const body = new FormData();
    body.set("intent", intent);
    body.set("enabled", form.enabled ? "1" : "0");
    body.set("invoiceAutoSend", form.invoiceAutoSend ? "1" : "0");
    body.set("invoiceWhen", form.invoiceWhen);
    body.set("creditNoteAutoSend", form.creditNoteAutoSend ? "1" : "0");
    body.set("refundDocumentAutoSend", form.refundDocumentAutoSend ? "1" : "0");
    body.set("ccStaff", form.ccStaff);
    body.set("fromName", form.fromName);
    body.set("replyTo", form.replyTo);
    body.set("emailLayout", form.emailLayout);
    body.set("showViewButton", form.showViewButton ? "1" : "0");
    body.set("invoiceBodyMode", form.invoiceBodyMode);
    body.set("invoiceSubject", form.invoiceSubject);
    body.set("invoiceBody", form.invoiceBody);
    body.set("invoiceBodyCustom", form.invoiceBodyCustom);
    body.set("creditNoteBodyMode", form.creditNoteBodyMode);
    body.set("creditNoteSubject", form.creditNoteSubject);
    body.set("creditNoteBody", form.creditNoteBody);
    body.set("creditNoteBodyCustom", form.creditNoteBodyCustom);
    body.set("refundBodyMode", form.refundBodyMode);
    body.set("refundSubject", form.refundSubject);
    body.set("refundBody", form.refundBody);
    body.set("refundBodyCustom", form.refundBodyCustom);
    body.set("documentKind", templateKind);
    return body;
  };

  const schedulePreview = useCallback(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      const body = buildFormData("preview");
      previewFetcher.submit(body, { method: "post" });
    }, 400);
    // buildFormData closes over form/templateKind
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, templateKind]);

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
    if (testing || !loaderData.emailConfigured) return;
    const body = buildFormData("test");
    body.set("testTo", testTo.trim());
    testFetcher.submit(body, { method: "post" });
  };

  const automationsEnabled = form.enabled;
  const emailFrom = loaderData.emailFrom;
  const isSandbox = Boolean(emailFrom && /@resend\.dev$/i.test(emailFrom));

  const activeBodyMode =
    templateKind === "credit_note"
      ? form.creditNoteBodyMode
      : templateKind === "refund"
        ? form.refundBodyMode
        : form.invoiceBodyMode;

  const linkPlaceholder =
    templateKind === "credit_note"
      ? "{{credit_note_link}}"
      : templateKind === "refund"
        ? "{{refund_link}}"
        : "{{invoice_link}}";

  return (
    <s-page heading="Email" inlineSize="large">
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

      {!loaderData.emailConfigured ? (
        <s-banner tone="critical" heading="Email not configured">
          Email delivery is not configured on the server. Contact your app
          administrator to enable sending, then redeploy.
        </s-banner>
      ) : isSandbox ? (
        <s-banner tone="warning" heading="Sandbox mode">
          {emailFrom} only delivers to your Resend account email. Verify your
          own domain for production.
        </s-banner>
      ) : emailFrom ? (
        <s-banner tone="info" heading="Mail ready">
          Sender address {emailFrom}. Verify this domain in Resend before
          sending to customers.
        </s-banner>
      ) : null}

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

      <s-paragraph>
        Send tax invoice PDFs automatically or manually from Invoices and Credit
        notes. Separate from Shopify order confirmations.
      </s-paragraph>

      <s-query-container>
        <s-grid gridTemplateColumns={GRID_MAIN_ASIDE} gap="base">
          <s-stack gap="base">
            <s-section
              heading="Automated emails"
              subheading="Send PDF documents when Shopify orders are paid or refunds are created."
            >
              <s-stack gap="base">
                <s-checkbox
                  label={automationsEnabled ? "Enabled" : "Disabled"}
                  checked={automationsEnabled}
                  onChange={(event: Event) => {
                    const checked = Boolean(
                      (event.currentTarget as HTMLInputElement).checked,
                    );
                    patch("enabled", checked);
                  }}
                />

                <s-box
                  padding="base"
                  background="subdued"
                  border="base"
                  borderRadius="base"
                >
                  <s-stack gap="base">
                    <s-stack gap="small">
                      <s-text type="strong">Tax invoices</s-text>
                      <s-paragraph>Email the invoice PDF to the customer.</s-paragraph>
                      <s-checkbox
                        label="Auto-send"
                        checked={form.invoiceAutoSend}
                        disabled={!automationsEnabled || undefined}
                        onChange={(event: Event) => {
                          patch(
                            "invoiceAutoSend",
                            Boolean(
                              (event.currentTarget as HTMLInputElement).checked,
                            ),
                          );
                        }}
                      />
                      <s-select
                        label="Trigger"
                        name="invoiceWhen"
                        value={form.invoiceWhen}
                        disabled={!automationsEnabled || undefined}
                        onChange={(event: Event) => {
                          const value = fieldValue(event);
                          patch(
                            "invoiceWhen",
                            value === "created" ? "created" : "paid",
                          );
                        }}
                      >
                        <s-option value="paid">When order is paid</s-option>
                        <s-option value="created">When invoice is created</s-option>
                      </s-select>
                    </s-stack>

                    <s-divider />

                    <s-stack gap="small">
                      <s-text type="strong">Credit notes</s-text>
                      <s-paragraph>
                        Sent after a Shopify refund creates a credit note.
                      </s-paragraph>
                      <s-checkbox
                        label="Auto-send"
                        checked={form.creditNoteAutoSend}
                        disabled={!automationsEnabled || undefined}
                        onChange={(event: Event) => {
                          patch(
                            "creditNoteAutoSend",
                            Boolean(
                              (event.currentTarget as HTMLInputElement).checked,
                            ),
                          );
                        }}
                      />
                    </s-stack>

                    <s-divider />

                    <s-stack gap="small">
                      <s-text type="strong">Refund documents</s-text>
                      <s-paragraph>
                        Customer refund receipt PDF on the same refund event.
                      </s-paragraph>
                      <s-checkbox
                        label="Auto-send"
                        checked={form.refundDocumentAutoSend}
                        disabled={!automationsEnabled || undefined}
                        onChange={(event: Event) => {
                          patch(
                            "refundDocumentAutoSend",
                            Boolean(
                              (event.currentTarget as HTMLInputElement).checked,
                            ),
                          );
                        }}
                      />
                    </s-stack>
                  </s-stack>
                </s-box>
              </s-stack>
            </s-section>

            <s-section
              heading="Email templates"
              subheading="Branded HTML emails with your logo and colors from Branding. Edit subject and message for each document type."
            >
              <s-stack gap="base">
                <s-choice-list
                  label="Layout"
                  name="emailLayout"
                  values={[form.emailLayout]}
                  onChange={(event: Event) => {
                    const values = (
                      event.currentTarget as unknown as {
                        values?: string[];
                      }
                    ).values;
                    const next = (values?.[0] || "classic") as EmailLayout;
                    patch(
                      "emailLayout",
                      next === "minimal" || next === "card" ? next : "classic",
                    );
                  }}
                >
                  <s-choice value="minimal">
                    Minimal — clean white layout with logo header
                  </s-choice>
                  <s-choice value="classic">
                    Classic — brand-colored header bar (recommended)
                  </s-choice>
                  <s-choice value="card">
                    Card — centered card on a soft background
                  </s-choice>
                </s-choice-list>

                <s-checkbox
                  label='Show “View document” button when a secure link is available'
                  checked={form.showViewButton}
                  onChange={(event: Event) => {
                    patch(
                      "showViewButton",
                      Boolean(
                        (event.currentTarget as HTMLInputElement).checked,
                      ),
                    );
                  }}
                />

                <s-button-group gap="none" accessibilityLabel="Email template type">
                  <s-button
                    slot="secondary-actions"
                    variant="secondary"
                    icon={templateKind === "invoice" ? "check" : undefined}
                    aria-pressed={templateKind === "invoice"}
                    onClick={() => setTemplateKind("invoice")}
                  >
                    Invoice
                  </s-button>
                  <s-button
                    slot="secondary-actions"
                    variant="secondary"
                    icon={templateKind === "credit_note" ? "check" : undefined}
                    aria-pressed={templateKind === "credit_note"}
                    onClick={() => setTemplateKind("credit_note")}
                  >
                    Credit note
                  </s-button>
                  <s-button
                    slot="secondary-actions"
                    variant="secondary"
                    icon={templateKind === "refund" ? "check" : undefined}
                    aria-pressed={templateKind === "refund"}
                    onClick={() => setTemplateKind("refund")}
                  >
                    Refund doc
                  </s-button>
                </s-button-group>

                <s-stack direction="inline" gap="small">
                  {(
                    [
                      "{{invoice_number}}",
                      "{{credit_note_number}}",
                      "{{order_number}}",
                      "{{shop_name}}",
                      "{{customer_name}}",
                      linkPlaceholder,
                    ] as const
                  ).map((ph) => (
                    <s-button
                      key={ph}
                      variant="tertiary"
                      onClick={() => appendToActiveBody(ph)}
                    >
                      {ph}
                    </s-button>
                  ))}
                </s-stack>
                <s-paragraph>
                  Secure link placeholders: view · print · download · 30-day
                  expiry.
                </s-paragraph>

                <TemplateFields
                  kind={templateKind}
                  form={form}
                  patch={patch}
                  activeBodyMode={activeBodyMode}
                />
              </s-stack>
            </s-section>
          </s-stack>

          <s-stack gap="base">
            <s-section
              heading="Sender"
              subheading="How your store appears in the inbox."
            >
              <s-stack gap="base">
                <s-text-field
                  label="From name"
                  name="fromName"
                  value={form.fromName}
                  placeholder="Store name"
                  onInput={(event: Event) => patch("fromName", fieldValue(event))}
                  onChange={(event: Event) => patch("fromName", fieldValue(event))}
                />
                <s-email-field
                  label="Reply-to"
                  name="replyTo"
                  value={form.replyTo}
                  placeholder="support@example.com"
                  details="Defaults to your business email when empty."
                  onInput={(event: Event) => patch("replyTo", fieldValue(event))}
                  onChange={(event: Event) => patch("replyTo", fieldValue(event))}
                />
              </s-stack>
            </s-section>

            <s-section
              heading="Recipients"
              subheading="Customer always receives at their order email."
            >
              <s-text-field
                label="CC staff"
                name="ccStaff"
                value={form.ccStaff}
                placeholder="ops@example.com, accounting@…"
                details="Comma-separated. Optional."
                onInput={(event: Event) => patch("ccStaff", fieldValue(event))}
                onChange={(event: Event) => patch("ccStaff", fieldValue(event))}
              />
            </s-section>

            <s-section
              heading="Live preview"
              subheading="Sample data · updates as you edit"
            >
              <s-stack gap="base">
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
                        background: "#fff",
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

                <s-stack gap="small">
                  <s-text type="strong">Send test</s-text>
                  <s-paragraph>
                    Uses current edits · no PDF · not saved until you click Save
                  </s-paragraph>
                  <s-email-field
                    label="Test recipient"
                    name="testTo"
                    value={testTo}
                    placeholder="you@store.com"
                    disabled={!loaderData.emailConfigured || undefined}
                    onInput={(event: Event) => setTestTo(fieldValue(event))}
                    onChange={(event: Event) => setTestTo(fieldValue(event))}
                  />
                  <s-button
                    variant="secondary"
                    onClick={sendTest}
                    {...(testing || !loaderData.emailConfigured
                      ? { loading: testing || undefined, disabled: true }
                      : {})}
                  >
                    Send test
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          </s-stack>
        </s-grid>
      </s-query-container>
    </s-page>
  );
}

function TemplateFields({
  kind,
  form,
  patch,
  activeBodyMode,
}: {
  kind: TemplateKind;
  form: DeliveryForm;
  patch: <K extends keyof DeliveryForm>(key: K, value: DeliveryForm[K]) => void;
  activeBodyMode: EmailBodyMode;
}) {
  const subjectKey =
    kind === "credit_note"
      ? "creditNoteSubject"
      : kind === "refund"
        ? "refundSubject"
        : "invoiceSubject";
  const modeKey =
    kind === "credit_note"
      ? "creditNoteBodyMode"
      : kind === "refund"
        ? "refundBodyMode"
        : "invoiceBodyMode";
  const bodyKey =
    kind === "credit_note"
      ? "creditNoteBody"
      : kind === "refund"
        ? "refundBody"
        : "invoiceBody";
  const customKey =
    kind === "credit_note"
      ? "creditNoteBodyCustom"
      : kind === "refund"
        ? "refundBodyCustom"
        : "invoiceBodyCustom";

  return (
    <s-stack gap="base">
      <s-text-field
        label="Subject line"
        name={subjectKey}
        value={form[subjectKey]}
        onInput={(event: Event) => patch(subjectKey, fieldValue(event))}
        onChange={(event: Event) => patch(subjectKey, fieldValue(event))}
      />

      <s-choice-list
        label="Which template is sent?"
        name={modeKey}
        values={[activeBodyMode]}
        onChange={(event: Event) => {
          const values = (
            event.currentTarget as unknown as { values?: string[] }
          ).values;
          const next =
            values?.[0] === "custom_html" ? "custom_html" : "designed";
          patch(modeKey, next);
        }}
      >
        <s-choice value="designed">
          Designed — rich-text message wrapped in your branded layout
        </s-choice>
        <s-choice value="custom_html">
          Custom HTML — your own HTML; full html documents skip the branded
          wrapper
        </s-choice>
      </s-choice-list>

      {activeBodyMode === "designed" ? (
        <s-text-area
          label="Message"
          name={bodyKey}
          value={form[bodyKey]}
          rows={10}
          details="HTML inside your branded email layout. Use placeholder chips above to insert fields."
          onInput={(event: Event) => patch(bodyKey, fieldValue(event))}
          onChange={(event: Event) => patch(bodyKey, fieldValue(event))}
        />
      ) : (
        <s-text-area
          label="Custom HTML"
          name={customKey}
          value={form[customKey]}
          rows={14}
          details="Write your own HTML with {{placeholders}}. A full <html> document skips the branded wrapper."
          onInput={(event: Event) => patch(customKey, fieldValue(event))}
          onChange={(event: Event) => patch(customKey, fieldValue(event))}
        />
      )}
    </s-stack>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
