const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** Groq retired llama-3.3-70b-versatile for free/dev tiers (2026-08-16). */
const DEFAULT_GROQ_SEO_MODEL = 'openai/gpt-oss-120b';
export const GROQ_SEO_MODEL =
  process.env.GROQ_SEO_MODEL?.trim() || DEFAULT_GROQ_SEO_MODEL;

export type SeoScanItem = {
  id: string;
  title: string;
  handle: string;
  body_html: string;
  type: string;
  seo: {title: string | null; description: string | null};
  blog_handle?: string;
};

export type SeoIssueBatchResult = {
  shopify_gid: string;
  issues: string[];
};

function requireGroqKey() {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('GROQ_API_KEY is not set');
  if (key.startsWith('crsr_')) {
    throw new Error(
      'GROQ_API_KEY is a Cursor key — replace it with a Groq API key from console.groq.com',
    );
  }
  return key;
}

async function callGroq(
  prompt: string,
  temperature = 0.3,
): Promise<Record<string, unknown> | unknown[]> {
  const key = requireGroqKey();
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GROQ_SEO_MODEL,
      messages: [{role: 'user', content: prompt}],
      temperature,
      max_tokens: 2048,
      response_format: {type: 'json_object'},
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Invalid GROQ_API_KEY — use a Groq key from console.groq.com (not a Cursor key).',
      );
    }
    throw new Error(`Groq API error ${response.status}: ${body}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{message?: {content?: string}}>;
  };
  const raw = json.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Groq response missing content');
  return JSON.parse(raw) as Record<string, unknown> | unknown[];
}

function stripHtml(html: string) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Keyword/quality analysis for items that already passed structural checks. */
export async function analyzeSeoBatch(
  items: SeoScanItem[],
): Promise<SeoIssueBatchResult[]> {
  if (!items.length) return [];

  try {
    const itemsJson = items.map((item, index) => ({
      index,
      type: item.type,
      name: item.title,
      seo_title: item.seo.title?.toString() || '',
      seo_description: item.seo.description?.toString() || '',
      content_summary: stripHtml(item.body_html).slice(0, 300),
    }));

    const prompt = `You are a Shopify SEO specialist. Analyze keyword quality of these store items.

For each item, check ONLY keyword and quality issues (length/missing issues are already handled):
- Does the SEO title include relevant keywords from the product name and content?
- Is the SEO description meaningful and specific to this item with relevant keywords?
- Is the content generic (e.g. "Buy now", "Great product"), off-topic, or keyword-stuffed?
- Does the SEO title match what someone would actually search for?

Rules:
- If seo_title or seo_description is empty, return NO issues for that field
- Be concise: each issue must be one short sentence
- Return issues ONLY if there is a clear keyword or quality problem
- If content looks fine, return empty issues array

Return a JSON object with key "results" containing an array of EXACTLY ${items.length} objects in the same order as input:
{"results": [{"issues": ["issue 1"]}, {"issues": []}, ...]}

Items:
${JSON.stringify(itemsJson)}`;

    const parsed = await callGroq(prompt, 0.3);
    let results: Array<{issues?: unknown}> = [];
    if (Array.isArray(parsed)) {
      results = parsed as Array<{issues?: unknown}>;
    } else if (isPlainObject(parsed)) {
      const first = Object.values(parsed).find((v) => Array.isArray(v));
      results = (first as Array<{issues?: unknown}>) || [];
    }

    return items.map((item, i) => ({
      shopify_gid: item.id,
      issues: Array.isArray(results[i]?.issues)
        ? (results[i].issues as unknown[]).map(String)
        : [],
    }));
  } catch (error) {
    console.error('[GroqSeoAnalyzer]', error);
    return items.map((item) => ({shopify_gid: item.id, issues: []}));
  }
}

function fitTitle(text: string) {
  if (text.length <= 60) return text;
  return text.slice(0, 60).replace(/\s\S+$/, '').trim();
}

function fitDescription(text: string) {
  if (text.length <= 160) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) || [];
  if (!sentences.length) return text.slice(0, 160);
  let result = '';
  for (const sentence of sentences) {
    const candidate = result ? `${result} ${sentence}` : sentence;
    if (candidate.length <= 160) result = candidate;
    else break;
  }
  return result || sentences[0];
}

export type SeoSuggestion = {
  meta_title?: string;
  meta_description?: string;
  alt_text?: string;
  handle?: string;
  h1?: string;
  h2?: string;
};

/** Generate optimized title/description for a scan result row. */
export async function suggestSeoMeta(input: {
  resourceType: string;
  resourceName: string | null;
  currentSeoTitle: string | null;
  currentSeoDescription: string | null;
  resourceBodySummary: string | null;
  issues: unknown;
}): Promise<SeoSuggestion> {
  const formula =
    input.resourceType === 'collection'
      ? '[Collection Name] – [Category or Audience]'
      : input.resourceType === 'page'
        ? '[Page Purpose] – [Action or Benefit]'
        : input.resourceType === 'blog_article'
          ? '[Main Topic] – [Subtopic or Key Takeaway]'
          : '[Product Name] – [Key Feature] | [Category]';

  const issues = Array.isArray(input.issues)
    ? input.issues.map(String)
    : [];
  const duplicateIssue = issues.find((i) =>
    i.startsWith('Duplicate SEO title'),
  );
  const duplicateContext = duplicateIssue
    ? `\nDUPLICATE ALERT: This item shares its SEO title with: ${duplicateIssue.replace('Duplicate SEO title shared with: ', '')}\nYou MUST generate a title that is clearly different.\n`
    : '';

  const prompt = `You are a Shopify SEO specialist. Generate a meta title and meta description for the item below.
${duplicateContext}
Item:
- Type: ${input.resourceType}
- Name: ${input.resourceName || 'Unknown'}
- Current title: ${input.currentSeoTitle || 'None'}
- Current description: ${input.currentSeoDescription || 'None'}
- Content: ${input.resourceBodySummary || 'None'}

Title formula: ${formula}
- Must be between 30 and 60 characters — tight and keyword-focused
- Use the item name as the primary keyword

Description formula: exactly 3 complete sentences
- Aim for 120–160 characters
- Sentence 1: what it is + key feature
- Sentence 2: main benefit
- Sentence 3: CTA ending with a period

Rules:
- No placeholder words like "ShopName" or "Brand"
- No filler phrases
- No comma-separated lists in description
- Do not start title with "Buy"
- Same language as the item name

Return ONLY valid JSON: {"meta_title": "...", "meta_description": "..."}`;

  const parsed = await callGroq(prompt, 0.4);
  if (!isPlainObject(parsed)) {
    throw new Error('Groq response was not an object');
  }
  const metaTitle = String(parsed.meta_title || '').trim();
  const metaDescription = String(parsed.meta_description || '').trim();
  if (!metaTitle || !metaDescription) {
    throw new Error('Groq response missing meta_title or meta_description');
  }
  return {
    meta_title: fitTitle(metaTitle),
    meta_description: fitDescription(metaDescription),
  };
}

export async function suggestImageAlt(input: {
  resourceName: string | null;
  currentImageAlt: string | null;
}): Promise<string> {
  const prompt = `You are a Shopify SEO specialist. Generate a short, descriptive image alt text.

Item:
- Name: ${input.resourceName || 'Unknown'}
- Current alt text: ${input.currentImageAlt || 'None'}

Rules:
- Must be under 125 characters
- Include the primary keyword from the item name naturally
- Be specific and descriptive
- Do NOT start with "image of", "photo of", or "picture of"
- Same language as the item name

Return ONLY valid JSON: {"alt_text": "..."}`;

  const parsed = await callGroq(prompt, 0.4);
  if (!isPlainObject(parsed)) throw new Error('Groq response was not an object');
  const alt = String(parsed.alt_text || '').trim().slice(0, 125);
  if (!alt) throw new Error('Groq response missing alt_text');
  return alt;
}

export async function suggestHandle(input: {
  resourceName: string | null;
  currentHandle: string | null;
  resourceType: string;
}): Promise<string> {
  const baseType = input.resourceType.replace(/_handle$/, '');
  const prompt = `Generate a clean, SEO-friendly URL handle for this Shopify resource.

Name: ${input.resourceName || 'Unknown'}
Current handle: ${input.currentHandle || 'None'}
Type: ${baseType}

Rules:
- Lowercase letters, numbers, and hyphens only
- No spaces, underscores, or special characters
- Max 60 characters
- Must reflect the primary keyword from the name
- Short and descriptive

Return ONLY valid JSON: {"handle": "..."}`;

  const parsed = await callGroq(prompt, 0.3);
  if (!isPlainObject(parsed)) throw new Error('Groq response was not an object');
  let handle = String(parsed.handle || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  if (!handle) throw new Error('Groq response missing handle');
  return handle;
}

export async function suggestHeadings(input: {
  resourceName: string | null;
  currentSeoTitle: string | null;
  issues: unknown;
}): Promise<{h1: string; h2?: string}> {
  const issues = Array.isArray(input.issues)
    ? input.issues.map(String)
    : [];
  const needsH2 = issues.some((i) => i.includes('Missing H2'));
  const prompt = `You are a Shopify SEO specialist. Generate heading text for this resource description.

Item:
- Name: ${input.resourceName || 'Unknown'}
- Current H1: ${input.currentSeoTitle || 'None'}
- Issues: ${issues.join(', ') || 'None'}

Generate:
- h1: main heading (3–8 words, includes primary keyword)
${needsH2 ? '- h2: one section subheading (3–6 words)' : ''}

Rules:
- Plain text only — no HTML tags
- Same language as the item name

${needsH2 ? 'Return ONLY valid JSON: {"h1": "...", "h2": "..."}' : 'Return ONLY valid JSON: {"h1": "..."}'}`;

  const parsed = await callGroq(prompt, 0.4);
  if (!isPlainObject(parsed)) throw new Error('Groq response was not an object');
  const h1 = String(parsed.h1 || '')
    .replace(/<[^>]+>/g, '')
    .trim();
  if (!h1) throw new Error('Groq response missing h1');
  const h2 = String(parsed.h2 || '')
    .replace(/<[^>]+>/g, '')
    .trim();
  return h2 ? {h1, h2} : {h1};
}
