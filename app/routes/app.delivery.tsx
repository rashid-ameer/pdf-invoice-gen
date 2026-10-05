import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  getDeliverySettings,
  isEmailProviderConfigured,
  saveDeliverySettings,
  type DeliverySettings,
  type EmailInvoiceWhen,
} from "../models/document-email.server";
import { authenticate } from "../shopify.server";

/**
 * Email configuration — which document emails auto-send, and when.
 * Template editing lives at /app/delivery/:type. Layout lives on Branding.
 */

const SAVE_BAR_ID = "email-config-save-bar";
const RESEND_DOMAINS_URL = "https://resend.com/domains";

type ConfigForm = {
  invoiceAutoSend: boolean;
  invoiceWhen: EmailInvoiceWhen;
  creditNoteAutoSend: boolean;
  refundDocumentAutoSend: boolean;
  fromName: string;
  replyTo: string;
  ccStaff: string;
};

type ActionResult =
  | { ok: true; settings: DeliverySettings; message: string }
  | { ok: false; error: string };

type DocumentTypeConfig = {
  id: "invoice" | "credit_note" | "refund";
  heading: string;
  description: string;
  switchLabel: string;
  templateHref: string;
  autoSendKey: "invoiceAutoSend" | "creditNoteAutoSend" | "refundDocumentAutoSend";
  hasTrigger: boolean;
};

const DOCUMENT_TYPES: DocumentTypeConfig[] = [
  {
    id: "invoice",
    heading: "Tax invoices",
    description: "Email the invoice PDF to the customer.",
    switchLabel: "Auto-send tax invoices",
    templateHref: "/app/delivery/invoice",
    autoSendKey: "invoiceAutoSend",
    hasTrigger: true,
  },
  {
    id: "credit_note",
    heading: "Credit notes",
    description: "Sent after a Shopify refund creates a credit note.",
    switchLabel: "Auto-send credit notes",
    templateHref: "/app/delivery/credit-note",
    autoSendKey: "creditNoteAutoSend",
    hasTrigger: false,
  },
  {
    id: "refund",
    heading: "Refund documents",
    description: "Refund receipt PDF sent on the same refund event.",
    switchLabel: "Auto-send refund documents",
    templateHref: "/app/delivery/refund",
    autoSendKey: "refundDocumentAutoSend",
    hasTrigger: false,
  },
];

function toConfigForm(settings: DeliverySettings): ConfigForm {
  return {
    invoiceAutoSend: settings.invoiceAutoSend,
    invoiceWhen: settings.invoiceWhen,
    creditNoteAutoSend: settings.creditNoteAutoSend,
    refundDocumentAutoSend: settings.refundDocumentAutoSend,
    fromName: settings.fromName,
    replyTo: settings.replyTo,
    ccStaff: settings.ccStaff,
  };
}

function fieldValue(event: Event): string {
  return String((event.currentTarget as HTMLInputElement | null)?.value ?? "");
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function checkboxOn(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "1" || value === "on" || value === "true";
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

  const replyTo = readString(formData, "replyTo");
  if (replyTo && !replyTo.includes("@")) {
    return {
      ok: false,
      error: "Enter a valid reply-to email address.",
    };
  }

  const invoiceWhenRaw = readString(formData, "invoiceWhen");
  const saved = await saveDeliverySettings(session.shop, {
    // Master flag removed from UI; keep API happy with true.
    enabled: true,
    invoiceAutoSend: checkboxOn(formData, "invoiceAutoSend"),
    invoiceWhen: invoiceWhenRaw === "created" ? "created" : "paid",
    creditNoteAutoSend: checkboxOn(formData, "creditNoteAutoSend"),
    refundDocumentAutoSend: checkboxOn(formData, "refundDocumentAutoSend"),
    fromName: readString(formData, "fromName"),
    replyTo,
    ccStaff: readString(formData, "ccStaff"),
  });

  if (!saved) {
    return { ok: false, error: "Store not found" };
  }

  return {
    ok: true,
    settings: saved,
    message: "Email settings saved",
  };
};

export default function EmailConfigPage() {
  const loaderData = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();

  const serverSettings =
    saveFetcher.data && saveFetcher.data.ok
      ? saveFetcher.data.settings
      : loaderData.settings;
  const serverKey = JSON.stringify(toConfigForm(serverSettings));

  const [baseline, setBaseline] = useState<ConfigForm>(() =>
    toConfigForm(serverSettings),
  );
  const [form, setForm] = useState<ConfigForm>(() =>
    toConfigForm(serverSettings),
  );
  const [connectionError, setConnectionError] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [replyToError, setReplyToError] = useState("");

  const awaitingSave = useRef(false);
  const dataAtSubmit = useRef(saveFetcher.data);

  const saving =
    saveFetcher.state === "submitting" || saveFetcher.state === "loading";

  useEffect(() => {
    const next = toConfigForm(serverSettings);
    setForm(next);
    setBaseline(next);
    setSaveError("");
    setReplyToError("");
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
    if (saveFetcher.data.ok) {
      setSaveError("");
      shopify.toast.show(saveFetcher.data.message);
      shopify.saveBar.hide(SAVE_BAR_ID);
      return;
    }
    setSaveError(saveFetcher.data.error);
    shopify.toast.show(saveFetcher.data.error, { isError: true });
  }, [saveFetcher.data, saveFetcher.state, shopify]);

  useEffect(() => {
    shopify.loading(saving);
    return () => {
      shopify.loading(false);
    };
  }, [saving, shopify]);

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

  const patch = useCallback(<K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const discardChanges = () => {
    if (saving) return;
    setForm(baseline);
    setSaveError("");
    setReplyToError("");
    setConnectionError(false);
    shopify.saveBar.hide(SAVE_BAR_ID);
  };

  const saveForm = () => {
    if (saving) return;
    if (form.replyTo && !form.replyTo.includes("@")) {
      setReplyToError("Enter a valid reply-to email address.");
      return;
    }
    setReplyToError("");
    dataAtSubmit.current = saveFetcher.data;
    awaitingSave.current = true;
    const body = new FormData();
    body.set("enabled", "1");
    body.set("invoiceAutoSend", form.invoiceAutoSend ? "1" : "0");
    body.set("invoiceWhen", form.invoiceWhen);
    body.set("creditNoteAutoSend", form.creditNoteAutoSend ? "1" : "0");
    body.set("refundDocumentAutoSend", form.refundDocumentAutoSend ? "1" : "0");
    body.set("fromName", form.fromName);
    body.set("replyTo", form.replyTo);
    body.set("ccStaff", form.ccStaff);
    saveFetcher.submit(body, { method: "post" });
  };

  const emailFrom = loaderData.emailFrom;
  const isSandbox = Boolean(emailFrom && /@resend\.dev$/i.test(emailFrom));

  return (
    <s-page heading="Email">
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

      {isSandbox ? (
        <s-banner
          slot="supplemental-start"
          tone="warning"
          heading="Sandbox mode"
        >
          Emails are only delivered to your email provider account email until
          you verify your own domain.
          <s-button
            slot="secondary-actions"
            variant="secondary"
            href={RESEND_DOMAINS_URL}
            target="_blank"
          >
            Verify domain
          </s-button>
        </s-banner>
      ) : null}

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

        <s-stack gap="none">
          <s-heading>Automated emails</s-heading>
          <s-paragraph color="subdued">
            Send PDF documents when Shopify orders are paid or refunds are
            created.
          </s-paragraph>
        </s-stack>

        {DOCUMENT_TYPES.map((doc) => (
          <DocumentTypeCard
            key={doc.id}
            config={doc}
            form={form}
            saving={saving}
            onToggle={(checked) => patch(doc.autoSendKey, checked)}
            onTriggerChange={(value) =>
              patch("invoiceWhen", value === "created" ? "created" : "paid")
            }
          />
        ))}
      </s-stack>

      <s-section
        slot="aside"
        heading="Sender"
        subheading="How your store appears in the inbox."
        
      >
        <s-stack gap="base">
          <s-text-field
            label="From name"
            name="fromName"
            value={form.fromName}
            placeholder="Store name"
            disabled={saving || undefined}
            onInput={(event: Event) => patch("fromName", fieldValue(event))}
            onChange={(event: Event) => patch("fromName", fieldValue(event))}
          />
          <s-text-field
            label="Reply-to"
            name="replyTo"
            value={form.replyTo}
            placeholder="support@example.com"
            details="Defaults to your business email when empty."
            error={replyToError || undefined}
            disabled={saving || undefined}
            onInput={(event: Event) => {
              setReplyToError("");
              patch("replyTo", fieldValue(event));
            }}
            onChange={(event: Event) => {
              setReplyToError("");
              patch("replyTo", fieldValue(event));
            }}
          />
        </s-stack>
      </s-section>

      <s-section
        slot="aside"
        heading="Recipients"
        subheading="Customers always receive the email at their order email."
      >
        <s-text-field
          label="CC staff (optional)"
          name="ccStaff"
          value={form.ccStaff}
          placeholder="ops@example.com, accounting@…"
          details="Comma-separated."
          disabled={saving || undefined}
          onInput={(event: Event) => patch("ccStaff", fieldValue(event))}
          onChange={(event: Event) => patch("ccStaff", fieldValue(event))}
        />
      </s-section>
    </s-page>
  );
}

function DocumentTypeCard({
  config,
  form,
  saving,
  onToggle,
  onTriggerChange,
}: {
  config: DocumentTypeConfig;
  form: ConfigForm;
  saving: boolean;
  onToggle: (checked: boolean) => void;
  onTriggerChange: (value: string) => void;
}) {
  const autoSend = form[config.autoSendKey];

  return (
    <s-section>
      <s-stack gap="base">
        <s-stack gap="none">
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
            gap="base"
          >
            <s-heading>{config.heading}</s-heading>
            <s-switch
              accessibilityLabel={config.switchLabel}
              label={config.switchLabel}
              checked={autoSend}
              disabled={saving || undefined}
              onChange={(event: Event) => {
                onToggle(
                  Boolean((event.currentTarget as HTMLInputElement).checked),
                );
              }}
            />
          </s-stack>

          <s-paragraph color="subdued">{config.description}</s-paragraph>
        </s-stack>

        {config.hasTrigger && autoSend ? (
          <s-select
            label="Send when"
            name="invoiceWhen"
            value={form.invoiceWhen}
            disabled={saving || undefined}
            onChange={(event: Event) => onTriggerChange(fieldValue(event))}
          >
            <s-option value="paid">When order is paid</s-option>
            <s-option value="created">When invoice is created</s-option>
          </s-select>
        ) : null}

        <s-stack direction="inline" gap="small">
          <s-button variant="secondary" href={config.templateHref}>
            Edit template
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
