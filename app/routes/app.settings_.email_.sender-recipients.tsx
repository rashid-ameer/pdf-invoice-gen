/**
 * Sender and recipients — from name, reply-to, CC staff.
 * Saves only sender fields via existing saveDeliverySettings merge.
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

import { EmailSandboxBanner } from "../components/email-sandbox-banner";
import {
  getDeliverySettings,
  saveDeliverySettings,
  type DeliverySettings,
} from "../models/document-email.server";
import { authenticate } from "../shopify.server";

const SAVE_BAR_ID = "email-sender-save-bar";

type SenderForm = {
  fromName: string;
  replyTo: string;
  ccStaff: string;
};

type ActionResult =
  | { ok: true; settings: DeliverySettings; message: string }
  | { ok: false; error: string };

function toForm(settings: DeliverySettings): SenderForm {
  return {
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getDeliverySettings(session.shop);
  if (!settings) {
    throw new Response("Store not found. Please reinstall the app.", {
      status: 404,
    });
  }
  return {
    settings,
    emailFrom: process.env.EMAIL_FROM ?? "",
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

  // Partial update — automation, layout, and template fields stay as stored.
  const saved = await saveDeliverySettings(session.shop, {
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

export default function SenderRecipientsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();

  const serverSettings =
    saveFetcher.data && saveFetcher.data.ok
      ? saveFetcher.data.settings
      : loaderData.settings;
  const serverKey = JSON.stringify(toForm(serverSettings));

  const [baseline, setBaseline] = useState<SenderForm>(() =>
    toForm(serverSettings),
  );
  const [form, setForm] = useState<SenderForm>(() => toForm(serverSettings));
  const [connectionError, setConnectionError] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [replyToError, setReplyToError] = useState("");

  const awaitingSave = useRef(false);
  const dataAtSubmit = useRef(saveFetcher.data);
  const saving =
    saveFetcher.state === "submitting" || saveFetcher.state === "loading";

  useEffect(() => {
    const next = toForm(serverSettings);
    setForm(next);
    setBaseline(next);
    setSaveError("");
    setReplyToError("");
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
    <K extends keyof SenderForm>(key: K, value: SenderForm[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

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
    body.set("fromName", form.fromName);
    body.set("replyTo", form.replyTo);
    body.set("ccStaff", form.ccStaff);
    saveFetcher.submit(body, { method: "post" });
  };

  return (
    <s-page heading="Sender and recipients">
      <s-link slot="breadcrumb-actions" href="/app/settings">
        Settings
      </s-link>
      <s-link slot="breadcrumb-actions" href="/app/settings/email">
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

      <EmailSandboxBanner emailFrom={loaderData.emailFrom} />

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
              Who your emails come from and who receives them.
            </s-text>
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
            <s-text-field
              label="CC staff (optional)"
              name="ccStaff"
              value={form.ccStaff}
              placeholder="ops@example.com, accounting@…"
              details="Comma-separated. Customers always receive the email at their order email."
              disabled={saving || undefined}
              onInput={(event: Event) => patch("ccStaff", fieldValue(event))}
              onChange={(event: Event) => patch("ccStaff", fieldValue(event))}
            />
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
