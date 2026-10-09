/**
 * Automated emails — document auto-send toggles (and invoice "Send when").
 * Saves only automation fields via existing saveDeliverySettings merge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { SettingsEmailBreadcrumbs } from "../components/settings-email-breadcrumbs";
import {
  getDeliverySettings,
  saveDeliverySettings,
  type DeliverySettings,
  type EmailInvoiceWhen,
} from "../models/document-email.server";
import { authenticate } from "../shopify.server";

const SAVE_BAR_ID = "email-automated-save-bar";

type AutomationForm = {
  invoiceAutoSend: boolean;
  invoiceWhen: EmailInvoiceWhen;
  creditNoteAutoSend: boolean;
  refundDocumentAutoSend: boolean;
};

type ActionResult =
  | { ok: true; settings: DeliverySettings; message: string }
  | { ok: false; error: string };

type AutomationRow = {
  id: "invoice" | "credit_note" | "refund";
  title: string;
  description: string;
  switchLabel: string;
  autoSendKey: "invoiceAutoSend" | "creditNoteAutoSend" | "refundDocumentAutoSend";
  hasTrigger: boolean;
};

const AUTOMATION_ROWS: AutomationRow[] = [
  {
    id: "invoice",
    title: "Tax invoices",
    description: "Email the invoice PDF to the customer.",
    switchLabel: "Auto-send tax invoices",
    autoSendKey: "invoiceAutoSend",
    hasTrigger: true,
  },
  {
    id: "credit_note",
    title: "Credit notes",
    description: "Sent after a Shopify refund creates a credit note.",
    switchLabel: "Auto-send credit notes",
    autoSendKey: "creditNoteAutoSend",
    hasTrigger: false,
  },
  {
    id: "refund",
    title: "Refund documents",
    description: "Refund receipt PDF sent on the same refund event.",
    switchLabel: "Auto-send refund documents",
    autoSendKey: "refundDocumentAutoSend",
    hasTrigger: false,
  },
];

function toForm(settings: DeliverySettings): AutomationForm {
  return {
    invoiceAutoSend: settings.invoiceAutoSend,
    invoiceWhen: settings.invoiceWhen,
    creditNoteAutoSend: settings.creditNoteAutoSend,
    refundDocumentAutoSend: settings.refundDocumentAutoSend,
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
  return { settings };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const invoiceWhenRaw = readString(formData, "invoiceWhen");

  // Partial update — other delivery fields (sender, layout, templates) stay as stored.
  const saved = await saveDeliverySettings(session.shop, {
    enabled: true,
    invoiceAutoSend: checkboxOn(formData, "invoiceAutoSend"),
    invoiceWhen: invoiceWhenRaw === "created" ? "created" : "paid",
    creditNoteAutoSend: checkboxOn(formData, "creditNoteAutoSend"),
    refundDocumentAutoSend: checkboxOn(formData, "refundDocumentAutoSend"),
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

export default function AutomatedEmailsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();

  const serverSettings =
    saveFetcher.data && saveFetcher.data.ok
      ? saveFetcher.data.settings
      : loaderData.settings;
  const serverKey = JSON.stringify(toForm(serverSettings));

  const [baseline, setBaseline] = useState<AutomationForm>(() =>
    toForm(serverSettings),
  );
  const [form, setForm] = useState<AutomationForm>(() =>
    toForm(serverSettings),
  );
  const [connectionError, setConnectionError] = useState(false);
  const [saveError, setSaveError] = useState("");

  const awaitingSave = useRef(false);
  const dataAtSubmit = useRef(saveFetcher.data);
  const saving =
    saveFetcher.state === "submitting" || saveFetcher.state === "loading";

  useEffect(() => {
    const next = toForm(serverSettings);
    setForm(next);
    setBaseline(next);
    setSaveError("");
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

  const patch = useCallback(
    <K extends keyof AutomationForm>(key: K, value: AutomationForm[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

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
    const body = new FormData();
    body.set("invoiceAutoSend", form.invoiceAutoSend ? "1" : "0");
    body.set("invoiceWhen", form.invoiceWhen);
    body.set("creditNoteAutoSend", form.creditNoteAutoSend ? "1" : "0");
    body.set("refundDocumentAutoSend", form.refundDocumentAutoSend ? "1" : "0");
    saveFetcher.submit(body, { method: "post" });
  };

  return (
    <s-page heading="Automated emails">
      <SettingsEmailBreadcrumbs />

      <ui-save-bar id={SAVE_BAR_ID}>
        <button
          variant="primary"
          onClick={saveForm}
          {...(saving ? { disabled: true, loading: "" } : {})}
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

        <s-section>
          <s-stack gap="base">
            <s-text color="subdued">
              Choose which documents are emailed automatically.
            </s-text>
            <s-stack gap="none">
              {AUTOMATION_ROWS.map((row, index) => (
                <s-stack key={row.id} gap="none">
                  <AutomationToggleRow
                    row={row}
                    form={form}
                    saving={saving}
                    onToggle={(checked) => patch(row.autoSendKey, checked)}
                    onTriggerChange={(value) =>
                      patch(
                        "invoiceWhen",
                        value === "created" ? "created" : "paid",
                      )
                    }
                  />
                  {index < AUTOMATION_ROWS.length - 1 ? <s-divider /> : null}
                </s-stack>
              ))}
            </s-stack>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

function AutomationToggleRow({
  row,
  form,
  saving,
  onToggle,
  onTriggerChange,
}: {
  row: AutomationRow;
  form: AutomationForm;
  saving: boolean;
  onToggle: (checked: boolean) => void;
  onTriggerChange: (value: string) => void;
}) {
  const autoSend = form[row.autoSendKey];

  return (
    <s-box paddingBlock="base">
      <s-stack gap="base">
        <s-grid
          gridTemplateColumns="1fr auto"
          gap="base"
          alignItems="center"
        >
          <s-stack gap="none">
            <s-heading>{row.title}</s-heading>
            <s-text color="subdued">{row.description}</s-text>
          </s-stack>
          <s-switch
            accessibilityLabel={row.switchLabel}
            checked={autoSend}
            disabled={saving || undefined}
            onChange={(event: Event) => {
              onToggle(
                Boolean((event.currentTarget as HTMLInputElement).checked),
              );
            }}
          />
        </s-grid>
        {row.hasTrigger && autoSend ? (
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
      </s-stack>
    </s-box>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
