import nodemailer from "nodemailer";

const APP_NAME = "PDF Invoice Generator CG";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactEmailData {
  name: string;
  phone: string;
  email: string;
  subject: string;
  message: string;
  shopDomain?: string;
}

export class HelpContactError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HelpContactError";
    this.status = status;
  }
}

export function getHelpPageLinks() {
  const supportEmail = (
    process.env.SUPPORT_MAIL ||
    process.env.SUPPORT_EMAIL ||
    "sbhattti1212@gmail.com"
  ).trim();

  const helpCenterUrl = (
    process.env.HELP_CENTER_URL ||
    "https://e-invoicing-cg-user-guide-4zcr.vercel.app"
  ).replace(/\/$/, "");

  const scheduleUrl =
    process.env.HELP_SCHEDULE_URL ||
    `mailto:${supportEmail}?subject=${encodeURIComponent(`${APP_NAME} — support call`)}`;

  return { supportEmail, helpCenterUrl, scheduleUrl, appName: APP_NAME };
}

function smtpConfig() {
  const portRaw = process.env.SMTP_PORT;
  const parsedPort =
    portRaw == null || portRaw.trim() === "" ? 465 : Number(portRaw);

  return {
    user: process.env.SMTP_EMAIL ?? "",
    pass: process.env.SMTP_PASS ?? "",
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number.isFinite(parsedPort) ? parsedPort : 465,
    secure: process.env.SMTP_SECURE !== "false",
  };
}

function isSmtpConfigured() {
  const { user, pass } = smtpConfig();
  return Boolean(user && pass);
}

/** Exported for parity checks / tests (old smtp-mailer.service). */
export function isHelpSmtpConfigured() {
  return isSmtpConfigured();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatMessageBody(message: string): string {
  return escapeHtml(message)
    .split("\n")
    .map((line) =>
      line.trim() === "" ? "<br />" : `<p style="margin:0 0 10px 0;">${line}</p>`,
    )
    .join("");
}

export function buildContactEmailHtml(data: ContactEmailData): string {
  const { name, email, subject, message, shopDomain } = data;
  const initial = escapeHtml(name.charAt(0).toUpperCase());
  const year = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Contact Message — ${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
          <tr>
            <td style="background-color:#000000;border-radius:16px 16px 0 0;padding:28px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="color:#ffffff;font-size:16px;font-weight:600;">${APP_NAME}</span><br/>
                    <span style="color:#9ca3af;font-size:11px;">In-app Help &amp; Support</span>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="background-color:#1a1a1a;color:#d1d5db;font-size:11px;padding:4px 12px;border-radius:20px;border:1px solid #333333;">New Message</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#111111;padding:16px 36px;">
              <p style="margin:0;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;">Subject</p>
              <p style="margin:4px 0 0 0;color:#ffffff;font-size:17px;font-weight:600;">${escapeHtml(subject)}</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;padding:36px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="40" style="vertical-align:top;padding-right:14px;">
                          <div style="width:40px;height:40px;background-color:#000000;border-radius:50%;text-align:center;line-height:40px;font-size:16px;font-weight:bold;color:#ffffff;">${initial}</div>
                        </td>
                        <td style="vertical-align:top;">
                          <p style="margin:0;font-size:14px;font-weight:600;color:#111827;">${escapeHtml(name)}</p>
                          <a href="mailto:${escapeHtml(email)}" style="color:#2c6ecb;font-size:13px;text-decoration:none;">${escapeHtml(email)}</a>
                          ${data.phone ? `<p style="margin:3px 0 0 0;font-size:13px;color:#6b7280;">${escapeHtml(data.phone)}</p>` : ""}
                          ${shopDomain ? `<p style="margin:3px 0 0 0;font-size:13px;color:#6b7280;">Shop: ${escapeHtml(shopDomain)}</p>` : ""}
                          <p style="margin:6px 0 0 0;font-size:11px;color:#9ca3af;">${formatDate()}</p>
                        </td>
                        <td align="right" style="vertical-align:top;">
                          <a href="mailto:${escapeHtml(email)}?subject=Re: ${escapeHtml(subject)}" style="display:inline-block;background-color:#000000;color:#ffffff;font-size:12px;font-weight:500;padding:8px 18px;border-radius:20px;text-decoration:none;">Reply</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;">Message</p>
              <div style="font-size:14px;color:#374151;line-height:1.7;border-left:3px solid #e5e7eb;padding-left:16px;">
                ${formatMessageBody(message)}
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 16px 16px;padding:24px 36px;">
              <p style="margin:0;font-size:12px;color:#6b7280;">Sent via the <strong>${APP_NAME}</strong> Help &amp; Support form.</p>
              <p style="margin:8px 0 0 0;font-size:11px;color:#d1d5db;">&copy; ${year} ${APP_NAME}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export function buildContactEmailText(data: ContactEmailData): string {
  return [
    `New contact message via ${APP_NAME} Help & Support`,
    `─────────────────────────────────────────`,
    `From:    ${data.name}`,
    `Email:   ${data.email}`,
    ...(data.phone ? [`Phone:   ${data.phone}`] : []),
    ...(data.shopDomain ? [`Shop:    ${data.shopDomain}`] : []),
    `Subject: ${data.subject}`,
    `─────────────────────────────────────────`,
    ``,
    data.message,
    ``,
    `─────────────────────────────────────────`,
    APP_NAME,
  ].join("\n");
}

function headerLine(value: string): string {
  let line = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 10 || code === 13) {
      line += " ";
      continue;
    }
    if (code <= 31 || code === 127) continue;
    line += char;
  }
  return line.trim();
}

function parseContactFields(input: ContactEmailData): ContactEmailData {
  const name = headerLine(input.name);
  const phone = headerLine(input.phone);
  const email = headerLine(input.email);
  const subject = headerLine(input.subject);
  const message = input.message.trim();

  if (!name || !email || !subject || !message) {
    throw new HelpContactError(
      "All fields are required and email must be valid.",
      400,
    );
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new HelpContactError("Please enter a valid email address.", 400);
  }

  return {
    name,
    phone,
    email,
    subject,
    message,
    shopDomain: input.shopDomain,
  };
}

export async function sendHelpContactEmail(input: ContactEmailData) {
  const parsed = parseContactFields(input);

  if (!isSmtpConfigured()) {
    console.error("[help-contact] SMTP is not configured");
    throw new HelpContactError(
      "Email is not configured. Please set SMTP_EMAIL and SMTP_PASS, then try again.",
      503,
    );
  }

  const smtp = smtpConfig();
  const supportEmail = getHelpPageLinks().supportEmail;

  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });

    const replyName = parsed.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    await transport.sendMail({
      // Matches old help-support route From display name.
      from: `"PDF Invoice Generator CG Support" <${smtp.user}>`,
      replyTo: `"${replyName}" <${parsed.email}>`,
      to: supportEmail || smtp.user,
      subject: `[Support] ${parsed.subject}`,
      text: buildContactEmailText(parsed),
      html: buildContactEmailHtml(parsed),
    });
  } catch (error) {
    if (error instanceof HelpContactError) throw error;
    console.error("[help-contact] Failed to send email:", error);
    throw new HelpContactError(
      "Failed to send message. Please try again.",
      500,
    );
  }
}
