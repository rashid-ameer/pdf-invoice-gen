import type { Browser, LaunchOptions } from 'puppeteer-core';

const IDLE_CLOSE_MS = 60_000;

function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

async function resolveLaunchOptions(): Promise<LaunchOptions> {
  if (isServerlessRuntime()) {
    // Optional serverless Chromium (install @sparticuz/chromium when deploying there).
    const chromiumMod = (await import("@sparticuz/chromium")) as {
      default: {
        args: string[];
        defaultViewport: LaunchOptions["defaultViewport"];
        executablePath: () => Promise<string>;
        headless: boolean | "shell";
      };
    };
    const chromium = chromiumMod.default;
    return {
      args: [
        ...chromium.args,
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    };
  }

  let executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
  if (!executablePath) {
    try {
      const puppeteer = await import("puppeteer");
      executablePath = puppeteer.default.executablePath();
    } catch {
      executablePath = undefined;
    }
  }

  return {
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  };
}

let pooledBrowser: Browser | null = null;
let pooledLaunch: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBrowserIdleClose() {
  if (isServerlessRuntime() || !pooledBrowser) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pooledBrowser) {
      const browser = pooledBrowser;
      pooledBrowser = null;
      browser.close().catch(() => undefined);
    }
  }, IDLE_CLOSE_MS);
}

async function waitForImages(page: { evaluate: (pageFunction: string) => Promise<unknown> }): Promise<void> {
  await page.evaluate(`
    Promise.all(
      Array.from(document.images).map(function (img) {
        return img.complete
          ? Promise.resolve()
          : new Promise(function (resolve) {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            });
      })
    )
  `);
}

async function acquireBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    const puppeteer = await import('puppeteer-core');
    const launchOptions = await resolveLaunchOptions();
    return puppeteer.default.launch(launchOptions);
  }

  if (pooledBrowser?.connected) {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    return pooledBrowser;
  }

  if (pooledBrowser) {
    pooledBrowser = null;
  }

  if (!pooledLaunch) {
    pooledLaunch = (async () => {
      const puppeteer = await import('puppeteer-core');
      const launchOptions = await resolveLaunchOptions();
      return puppeteer.default.launch(launchOptions);
    })().catch((error) => {
      pooledLaunch = null;
      throw error;
    });
  }

  const browser = await pooledLaunch;
  pooledLaunch = null;
  pooledBrowser = browser;
  browser.on('disconnected', () => {
    if (pooledBrowser === browser) {
      pooledBrowser = null;
    }
  });
  return browser;
}

async function releaseBrowser(browser: Browser): Promise<void> {
  if (isServerlessRuntime()) {
    await browser.close().catch(() => undefined);
    return;
  }
  scheduleBrowserIdleClose();
}

/**
 * Convert A4 document HTML into a PDF buffer.
 * Reuses a pooled browser on persistent servers; per-call launch on serverless.
 */
export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const browser = await acquireBrowser();
  let page = null;

  try {
    page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: 20_000,
    });
    await waitForImages(page);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    await releaseBrowser(browser);
  }
}

export function pdfFilename(base: string): string {
  const cleaned = base
    .replace(/\.html$/i, '')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${cleaned || 'document'}.pdf`;
}

/** Render the first page of A4 document HTML as a PNG thumbnail (modal preview). */
export async function htmlToPreviewPng(html: string): Promise<Buffer> {
  const browser = await acquireBrowser();
  let page = null;

  try {
    page = await browser.newPage();
    await page.setViewport({
      width: 720,
      height: 1020,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: 20_000,
    });
    await waitForImages(page);
    // JPEG has no alpha — transparent html/body becomes black. Force a white
    // page so code/starter templates (no layout engine bg) match layout thumbs.
    await page.evaluate(() => {
      const root = document.documentElement;
      const bodyEl = document.body;
      if (root) root.style.backgroundColor = '#ffffff';
      if (bodyEl) bodyEl.style.backgroundColor = '#ffffff';
    });
    const body = await page.$('body');
    if (!body) {
      throw new Error('Preview body missing');
    }
    const screenshot = await body.screenshot({
      type: 'jpeg',
      quality: 72,
      omitBackground: false,
    });
    return Buffer.from(screenshot);
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    await releaseBrowser(browser);
  }
}
