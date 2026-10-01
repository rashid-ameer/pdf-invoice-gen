const ALLOWED_STYLE_PROPS: Record<string, RegExp> = {
  'font-size': /^\d{1,2}px$/,
  color: /^#[0-9a-fA-F]{3,6}$/,
  'font-weight': /^(normal|bold|[1-9]00)$/,
  'font-style': /^(normal|italic)$/,
  'text-decoration': /^(none|underline|line-through)$/,
  'text-align': /^(left|center|right|justify)$/,
};

function sanitizeStyle(style: string): string {
  const parts = style
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const safe: string[] = [];
  for (const part of parts) {
    const [prop, ...rest] = part.split(':');
    if (!prop || rest.length === 0) continue;
    const key = prop.trim().toLowerCase();
    const value = rest.join(':').trim();
    const rule = ALLOWED_STYLE_PROPS[key];
    if (rule && rule.test(value)) {
      safe.push(`${key}: ${value}`);
    }
  }
  return safe.join('; ');
}

/** Strip dangerous markup while preserving allowed rich-text tags. */
export function sanitizeRichTextHtml(html: string): string {
  if (!html.trim()) return '';

  let cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  cleaned = cleaned.replace(/<\/?(?!p|br|strong|em|u|b|i|span|div\b)[a-z][^>]*>/gi, '');

  cleaned = cleaned.replace(/style\s*=\s*("([^"]*)"|'([^']*)')/gi, (_match, _q, dquoted, squoted) => {
    const styleVal = dquoted || squoted || '';
    const safe = sanitizeStyle(styleVal);
    return safe ? `style="${safe}"` : '';
  });

  return cleaned.trim();
}

export function sanitizeTemplateConfigContent(content: {
  documentTitle: { html: string };
  subtitle: { html: string };
  footer: { html: string };
  terms: { html: string };
  customNote: { html: string };
  showTerms?: boolean;
  showNotes?: boolean;
}) {
  return {
    documentTitle: { html: sanitizeRichTextHtml(content.documentTitle.html) },
    subtitle: { html: sanitizeRichTextHtml(content.subtitle.html) },
    footer: { html: sanitizeRichTextHtml(content.footer.html) },
    terms: { html: sanitizeRichTextHtml(content.terms.html) },
    customNote: { html: sanitizeRichTextHtml(content.customNote.html) },
    showTerms: content.showTerms !== false,
    showNotes: content.showNotes !== false,
  };
}

export function sanitizeTemplateTranslations(translations: {
  documentTitle?: { html: string };
  subtitle?: { html: string };
  footer?: { html: string };
  labels?: Record<string, string>;
}) {
  return {
    documentTitle: { html: sanitizeRichTextHtml(translations.documentTitle?.html ?? '') },
    subtitle: { html: sanitizeRichTextHtml(translations.subtitle?.html ?? '') },
    footer: { html: sanitizeRichTextHtml(translations.footer?.html ?? '') },
    labels: translations.labels ?? {},
  };
}

export function richTextToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function richTextHasContent(html: string | undefined | null): boolean {
  return Boolean(html && richTextToPlainText(html));
}

export function richTextOrEmpty(html: string | undefined | null): string {
  return richTextHasContent(html) ? String(html).trim() : '';
}
