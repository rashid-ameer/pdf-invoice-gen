import type { StoreBrandingData } from './branding.server';

export type EmailLayout = 'minimal' | 'classic' | 'card';
export type EmailDocumentKind = 'invoice' | 'credit_note' | 'refund';
export type EmailBodyMode = 'designed' | 'custom_html';

export const EMAIL_LAYOUTS: EmailLayout[] = ['minimal', 'classic', 'card'];

export interface RenderBrandedEmailOptions {
  layout: EmailLayout;
  showViewButton: boolean;
  documentKind: EmailDocumentKind;
  bodyMode?: EmailBodyMode;
  /** Designed-mode HTML after placeholders are applied. */
  bodyContent: string;
  /** Custom HTML template after placeholders are applied (custom_html mode). */
  customBodyContent?: string;
  shopName: string;
  documentLink?: string;
  branding: StoreBrandingData;
}

export const DEFAULT_INVOICE_EMAIL_BODY =
  '<p>Hi <strong>{{customer_name}}</strong>,</p><p>Please find your invoice <strong>{{invoice_number}}</strong> for order <strong>{{order_number}}</strong> attached.</p><p>Thank you,<br>{{shop_name}}</p>';

export const DEFAULT_CREDIT_NOTE_EMAIL_BODY =
  '<p>Hi <strong>{{customer_name}}</strong>,</p><p>Please find your credit note <strong>{{credit_note_number}}</strong> for order <strong>{{order_number}}</strong> attached.</p><p>Thank you,<br>{{shop_name}}</p>';

export const DEFAULT_REFUND_EMAIL_BODY =
  '<p>Hi <strong>{{customer_name}}</strong>,</p><p>Please find your refund document <strong>{{credit_note_number}}</strong> for order <strong>{{order_number}}</strong> attached.</p><p>Thank you,<br>{{shop_name}}</p>';

export const DEFAULT_CUSTOM_INVOICE_EMAIL_BODY = `<p>Hi {{customer_name}},</p>
<p>Your invoice <strong>{{invoice_number}}</strong> for order {{order_number}} is attached.</p>
<p><a href="{{invoice_link}}">View invoice online</a></p>
<p>Thank you,<br>{{shop_name}}</p>`;

export const DEFAULT_CUSTOM_CREDIT_NOTE_EMAIL_BODY = `<p>Hi {{customer_name}},</p>
<p>Your credit note <strong>{{credit_note_number}}</strong> for order {{order_number}} is attached.</p>
<p><a href="{{credit_note_link}}">View credit note online</a></p>
<p>Thank you,<br>{{shop_name}}</p>`;

export const DEFAULT_CUSTOM_REFUND_EMAIL_BODY = `<p>Hi {{customer_name}},</p>
<p>Your refund document <strong>{{credit_note_number}}</strong> for order {{order_number}} is attached.</p>
<p><a href="{{refund_link}}">View refund document online</a></p>
<p>Thank you,<br>{{shop_name}}</p>`;

export function normalizeEmailBodyMode(value: unknown): EmailBodyMode {
  return value === 'custom_html' ? 'custom_html' : 'designed';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }
  return '';
}

export function normalizeEmailLayout(value: unknown): EmailLayout {
  if (value === 'minimal' || value === 'card') return value;
  return 'classic';
}

/** Markdown-lite → safe HTML for email body content. Supports **bold**, [label](url), and auto-linked URLs. */
export function richTextToHtml(text: string): string {
  const tokens: string[] = [];
  let work = text;

  work = work.replace(/\*\*([^*]+)\*\*/g, (_, content: string) => {
    tokens.push(`<strong>${escapeHtml(content)}</strong>`);
    return `\x00T${tokens.length - 1}\x00`;
  });

  work = work.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => {
    const safeUrl = sanitizeUrl(url);
    tokens.push(
      safeUrl
        ? `<a href="${safeUrl}" style="color:#0d5c45;text-decoration:underline;">${escapeHtml(label)}</a>`
        : `${escapeHtml(label)} (${escapeHtml(url)})`
    );
    return `\x00T${tokens.length - 1}\x00`;
  });

  let html = escapeHtml(work);
  html = html.replace(/\x00T(\d+)\x00/g, (_, index: string) => tokens[Number(index)] ?? '');

  html = html.replace(/(^|[\s(])((https?:\/\/[^\s<)]+))/g, (match, prefix: string, url: string) => {
    const trimmed = url.replace(/[.,;:!?)]+$/, '');
    const safeUrl = sanitizeUrl(trimmed);
    if (!safeUrl) return match;
    const suffix = url.slice(trimmed.length);
    return `${prefix}<a href="${safeUrl}" style="color:#0d5c45;text-decoration:underline;">${escapeHtml(url)}</a>${escapeHtml(suffix)}`;
  });

  return html.replace(/\n/g, '<br/>');
}

/** Strip markdown markers for plain-text fallback. */
export function richTextToPlain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim();
}

export function looksLikeHtmlBody(value: string): boolean {
  return /<\s*(p|br|strong|b|em|i|u|a|div|ul|ol|li)\b/i.test(value);
}

export function sanitizeEmailBodyHtml(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');

  out = out.replace(
    /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>/gi,
    (_match, _before: string, href: string) => {
      const safe = sanitizeUrl(href);
      if (!safe) return '';
      return `<a href="${safe.replace(/"/g, '&quot;')}" style="color:#0d5c45;text-decoration:underline;">`;
    }
  );

  return out.trim();
}

/** Custom HTML — allows common email tags; strips scripts and unsafe attrs. */
export function sanitizeCustomEmailHtml(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');

  out = out.replace(
    /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>/gi,
    (_match, _before: string, href: string) => {
      const safe = sanitizeUrl(href);
      if (!safe) return '';
      return `<a href="${safe.replace(/"/g, '&quot;')}">`;
    }
  );

  return out.trim();
}

function stripQuillUiSpans(html: string): string {
  return html.replace(/<span[^>]*class="[^"]*ql-ui[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '');
}

/** Quill 2 renders both bullet and ordered lists as <ol> with li[data-list]. Convert for email clients. */
export function normalizeQuillLists(html: string): string {
  if (!/<ol[\s>]/i.test(html) && !/<li[^>]*data-list=/i.test(html)) {
    return html;
  }

  return html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner: string) => {
    const liRegex = /<li([^>]*)>([\s\S]*?)<\/li>/gi;
    const segments: Array<{ tag: 'ul' | 'ol'; items: string[] }> = [];
    let match: RegExpExecArray | null;

    while ((match = liRegex.exec(inner)) !== null) {
      const attrs = match[1];
      const content = stripQuillUiSpans(match[2]).trim();
      const isBullet =
        /data-list=["']bullet["']/i.test(attrs) || /data-list=["']unchecked["']/i.test(attrs);
      const tag: 'ul' | 'ol' = isBullet ? 'ul' : 'ol';
      const last = segments[segments.length - 1];
      if (last && last.tag === tag) {
        last.items.push(content);
      } else {
        segments.push({ tag, items: [content] });
      }
    }

    if (segments.length === 0) {
      return `<ol style="margin:0 0 12px;padding-left:24px;list-style-type:decimal;">${inner}</ol>`;
    }

    return segments
      .map(({ tag, items }) => {
        const listStyle = tag === 'ul' ? 'disc' : 'decimal';
        const lis = items
          .map((item) => `<li style="margin:0 0 4px;">${item}</li>`)
          .join('');
        return `<${tag} style="margin:0 0 12px;padding-left:24px;list-style-type:${listStyle};">${lis}</${tag}>`;
      })
      .join('');
  });
}

export function defaultDesignedEmailBody(documentKind: EmailDocumentKind): string {
  if (documentKind === 'credit_note') return DEFAULT_CREDIT_NOTE_EMAIL_BODY;
  if (documentKind === 'refund') return DEFAULT_REFUND_EMAIL_BODY;
  return DEFAULT_INVOICE_EMAIL_BODY;
}

export function defaultCustomEmailBody(documentKind: EmailDocumentKind): string {
  if (documentKind === 'credit_note') return DEFAULT_CUSTOM_CREDIT_NOTE_EMAIL_BODY;
  if (documentKind === 'refund') return DEFAULT_CUSTOM_REFUND_EMAIL_BODY;
  return DEFAULT_CUSTOM_INVOICE_EMAIL_BODY;
}

/** True when HTML has visible text (not just empty tags). Placeholders count as content. */
export function emailHasMeaningfulContent(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed) return false;
  return emailBodyHtmlToPlainText(trimmed).length > 0;
}

export function resolveEmailBodiesForSend(options: {
  documentKind: EmailDocumentKind;
  bodyMode: EmailBodyMode;
  designedBody: string;
  customBody: string;
}): { designedBody: string; customBody: string } {
  let designedBody = normalizeEmailBodyContent(options.designedBody);
  let customBody = sanitizeCustomEmailHtml(options.customBody);

  if (options.bodyMode === 'designed' && !emailHasMeaningfulContent(designedBody)) {
    designedBody = defaultDesignedEmailBody(options.documentKind);
  }
  if (options.bodyMode === 'custom_html' && !emailHasMeaningfulContent(customBody)) {
    customBody = defaultCustomEmailBody(options.documentKind);
  }

  return { designedBody, customBody };
}

/** Normalize stored body: HTML as-is (sanitized), legacy markdown/plain → HTML. */
export function normalizeEmailBodyContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const html = looksLikeHtmlBody(trimmed)
    ? sanitizeEmailBodyHtml(trimmed)
    : sanitizeEmailBodyHtml(richTextToHtml(trimmed));
  return normalizeQuillLists(html);
}

export function emailBodyHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyContentToHtml(bodyContent: string): string {
  return normalizeEmailBodyContent(bodyContent);
}

function ctaLabel(documentKind: EmailDocumentKind): string {
  if (documentKind === 'credit_note') return 'View credit note';
  if (documentKind === 'refund') return 'View refund document';
  return 'View invoice';
}

function buildCtaHtml(link: string, accentColor: string, label: string): string {
  const safeUrl = sanitizeUrl(link);
  if (!safeUrl) return '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 8px;">
      <tr>
        <td align="center" style="border-radius:999px;background:${accentColor};">
          <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

function logoHtml(logoUrl: string, shopName: string): string {
  if (!logoUrl) return '';
  const alt = escapeHtml(shopName || 'Logo');
  return `<img src="${logoUrl.replace(/"/g, '%22')}" alt="${alt}" width="140" style="display:block;max-width:140px;max-height:48px;height:auto;margin:0 auto 12px;border:0;" />`;
}

function wrapLayout(options: {
  layout: EmailLayout;
  branding: StoreBrandingData;
  shopName: string;
  bodyHtml: string;
  ctaHtml: string;
}): string {
  const { layout, branding, shopName, bodyHtml, ctaHtml } = options;
  const primary = branding.primaryColor || '#0d5c45';
  const secondary = branding.secondaryColor || '#6b7280';
  const footer = escapeHtml(branding.footerText || 'Thank you for your business');
  const title = escapeHtml(shopName || 'Your store');
  const logo = logoHtml(branding.logoUrl, shopName);
  const font =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const bodyBlock = `
    <div style="font-family:${font};font-size:15px;line-height:1.6;color:#111827;">
      ${bodyHtml}
    </div>
    ${ctaHtml}`;

  if (layout === 'minimal') {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding-bottom:20px;text-align:left;">
              ${logo || `<div style="font-family:${font};font-size:18px;font-weight:700;color:${primary};">${title}</div>`}
            </td>
          </tr>
          <tr><td>${bodyBlock}</td></tr>
          <tr>
            <td style="padding-top:28px;border-top:1px solid #e5e7eb;font-family:${font};font-size:12px;line-height:1.5;color:${secondary};text-align:center;">
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  if (layout === 'card') {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#eef1f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="padding:28px 28px 8px;text-align:center;">
              ${logo}
              <div style="font-family:${font};font-size:17px;font-weight:700;color:#111827;">${title}</div>
            </td>
          </tr>
          <tr><td style="padding:16px 28px 28px;">${bodyBlock}</td></tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;font-family:${font};font-size:12px;line-height:1.5;color:${secondary};text-align:center;">
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  // classic (default)
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06);">
          <tr>
            <td align="center" style="padding:28px 24px;background:${primary};">
              ${logo}
              <div style="font-family:${font};font-size:18px;font-weight:700;color:#ffffff;">${title}</div>
            </td>
          </tr>
          <tr><td style="padding:32px 28px;">${bodyBlock}</td></tr>
          <tr>
            <td style="padding:18px 24px;background:#f9fafb;font-family:${font};font-size:12px;line-height:1.5;color:${secondary};text-align:center;">
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function isFullEmailDocument(html: string): boolean {
  return /^\s*<!DOCTYPE/i.test(html) || /^\s*<html[\s>]/i.test(html);
}

function minimalCustomEmailShell(bodyHtml: string, shopName: string): string {
  const title = escapeHtml(shopName || 'Email');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;">
          <tr>
            <td style="padding:28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111827;">
              ${bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderCustomEmailHtml(options: {
  customHtml: string;
  shopName: string;
  showViewButton: boolean;
  documentLink?: string;
  documentKind: EmailDocumentKind;
  branding: StoreBrandingData;
}): string {
  const content = sanitizeCustomEmailHtml(options.customHtml);
  const link = options.documentLink?.trim() || '';
  const ctaHtml =
    options.showViewButton && link
      ? buildCtaHtml(link, options.branding.accentColor || options.branding.primaryColor, ctaLabel(options.documentKind))
      : '';
  const bodyBlock = `${content}${ctaHtml}`;

  if (isFullEmailDocument(content)) {
    if (!ctaHtml) return content;
    if (content.includes('</body>')) {
      return content.replace('</body>', `${ctaHtml}</body>`);
    }
    return content + ctaHtml;
  }

  return minimalCustomEmailShell(bodyBlock, options.shopName);
}

export function renderBrandedEmailHtml(options: RenderBrandedEmailOptions): string {
  if (options.bodyMode === 'custom_html') {
    return renderCustomEmailHtml({
      customHtml: options.customBodyContent || options.bodyContent,
      shopName: options.shopName,
      showViewButton: options.showViewButton,
      documentLink: options.documentLink,
      documentKind: options.documentKind,
      branding: options.branding,
    });
  }

  const bodyHtml = bodyContentToHtml(options.bodyContent);
  const link = options.documentLink?.trim() || '';
  const ctaHtml =
    options.showViewButton && link
      ? buildCtaHtml(link, options.branding.accentColor || options.branding.primaryColor, ctaLabel(options.documentKind))
      : '';

  return wrapLayout({
    layout: options.layout,
    branding: options.branding,
    shopName: options.shopName,
    bodyHtml,
    ctaHtml,
  });
}

export function renderBrandedEmail(options: RenderBrandedEmailOptions): { html: string; text: string } {
  if (options.bodyMode === 'custom_html') {
    const customHtml = sanitizeCustomEmailHtml(options.customBodyContent || options.bodyContent);
    const plainBody = emailBodyHtmlToPlainText(customHtml);
    const link = options.documentLink?.trim() || '';
    const lines = [plainBody];
    if (options.showViewButton && link) {
      lines.push('', `${ctaLabel(options.documentKind)}: ${link}`);
    }
    const footer = options.branding.footerText?.trim();
    if (footer) lines.push('', footer);
    return {
      html: renderBrandedEmailHtml(options),
      text: lines.filter(Boolean).join('\n'),
    };
  }

  const bodyHtml = bodyContentToHtml(options.bodyContent);
  const plainBody = emailBodyHtmlToPlainText(bodyHtml);
  const link = options.documentLink?.trim() || '';
  const lines = [plainBody];

  if (options.showViewButton && link) {
    lines.push('', `${ctaLabel(options.documentKind)}: ${link}`);
  }

  const footer = options.branding.footerText?.trim();
  if (footer) {
    lines.push('', footer);
  }

  return {
    html: renderBrandedEmailHtml(options),
    text: lines.filter(Boolean).join('\n'),
  };
}
