/**
 * Resend client for customer document email (Group 12).
 * Separate from Help/Support SMTP (`help-support.server.ts`).
 */

import { Resend } from "resend";

export type ResendSendInput = {
  to: string;
  cc: string[];
  fromName: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  filename?: string;
  pdf?: Buffer;
};

export type ResendSendSuccess = {
  ok: true;
  id: string;
  from: string;
  lastEvent?: string;
};

export type ResendSendFailure = {
  ok: false;
  error: string;
};

export type ResendSendResult = ResendSendSuccess | ResendSendFailure;

export function getResendConfig(): {
  apiKey: string;
  from: string;
} {
  return {
    apiKey: process.env.RESEND_API_KEY ?? "",
    from: process.env.EMAIL_FROM ?? "",
  };
}

export function isResendConfigured(): boolean {
  const { apiKey, from } = getResendConfig();
  return Boolean(apiKey && from);
}

function formatResendSendError(
  message: string | undefined,
  emailFrom: string,
): string {
  const raw = (message || "Resend send failed").trim();
  const lower = raw.toLowerCase();
  if (
    lower.includes("domain") &&
    (lower.includes("not verified") || lower.includes("verify"))
  ) {
    return (
      `Resend rejected the sender address (${emailFrom || "EMAIL_FROM"}): domain is not verified. ` +
      `This is about the From address in Vercel env EMAIL_FROM — not the public invoice link URL. ` +
      `Fix: Resend → Domains → verify your domain, then set EMAIL_FROM to an address on that domain ` +
      `(e.g. invoices@yourdomain.com). For quick tests only, use onboarding@resend.dev (delivers only to your Resend account email).`
    );
  }
  return raw;
}

/** Default Resend transport — injectable for tests via setResendTransportForTests. */
export async function sendViaResend(
  options: ResendSendInput,
): Promise<ResendSendResult> {
  const config = getResendConfig();
  if (!config.apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  if (!config.from) {
    return { ok: false, error: "EMAIL_FROM is not configured" };
  }

  const hasPdf = Boolean(options.pdf?.length);
  if (options.pdf && !options.pdf.length) {
    return { ok: false, error: "PDF attachment is empty" };
  }

  const resend = new Resend(config.apiKey);
  const from = options.fromName
    ? `${options.fromName.replace(/[<>]/g, "").trim()} <${config.from}>`
    : config.from;

  const attachments = hasPdf
    ? [
        {
          filename: (options.filename || "document").endsWith(".pdf")
            ? options.filename!
            : `${options.filename || "document"}.pdf`,
          content: options.pdf!.toString("base64"),
          contentType: "application/pdf" as const,
        },
      ]
    : undefined;

  const { data, error } = await resend.emails.send({
    from,
    to: [options.to],
    cc: options.cc.length ? options.cc : undefined,
    replyTo: options.replyTo || undefined,
    subject: options.subject,
    text: options.text,
    html: options.html,
    attachments,
  });

  if (error) {
    return {
      ok: false,
      error: formatResendSendError(error.message, config.from),
    };
  }
  if (!data?.id) {
    return { ok: false, error: "Resend did not return an email id" };
  }

  let lastEvent: string | undefined;
  try {
    const status = await resend.emails.get(data.id);
    lastEvent = status.data?.last_event || undefined;
  } catch (statusError) {
    console.warn("[email] could not fetch Resend status:", statusError);
  }

  console.log(
    `[email] resend accepted id=${data.id} to=${options.to} from=${from} lastEvent=${lastEvent || "unknown"}${hasPdf ? ` file=${options.filename}` : " (no attachment)"}`,
  );
  return { ok: true, id: data.id, from, lastEvent };
}

let transportImpl: (options: ResendSendInput) => Promise<ResendSendResult> =
  sendViaResend;

/** Test hook — restores to real Resend when passed null. */
export function setResendTransportForTests(
  fn: ((options: ResendSendInput) => Promise<ResendSendResult>) | null,
): void {
  transportImpl = fn ?? sendViaResend;
}

export async function deliverViaResend(
  options: ResendSendInput,
): Promise<ResendSendResult> {
  return transportImpl(options);
}

/** Look up delivery status in Resend (sent / delivered / bounced / delayed / …). */
export async function getEmailProviderStatus(providerId: string): Promise<{
  ok: boolean;
  error?: string;
  id?: string;
  from?: string;
  to?: string[];
  subject?: string;
  lastEvent?: string;
  createdAt?: string;
}> {
  const config = getResendConfig();
  if (!config.apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  if (!providerId?.trim()) {
    return { ok: false, error: "providerId is required" };
  }

  const resend = new Resend(config.apiKey);
  const { data, error } = await resend.emails.get(providerId.trim());
  if (error) {
    return { ok: false, error: error.message || "Failed to fetch email status" };
  }
  if (!data) {
    return { ok: false, error: "Email not found at provider" };
  }

  return {
    ok: true,
    id: data.id,
    from: data.from,
    to: data.to,
    subject: data.subject,
    lastEvent: data.last_event,
    createdAt: data.created_at,
  };
}
