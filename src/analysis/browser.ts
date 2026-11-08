// スクリーンショット取得・表示計測（Playwright）。
// ブラウザの追加通信（画像・CSS・JS・リダイレクト）もすべて SSRF 検査を通す。
// ブラウザが見つからない環境では null を返し、該当項目は「未確認」になる。
import fs from 'node:fs';
import path from 'node:path';
import { validateTarget, isFixtureHost } from '../net/ssrf.js';
import { readFixture } from '../net/fixtures.js';
import { LIMITS } from '../config.js';

export interface Capture {
  kind: 'pc' | 'sp';
  file: string;
  width: number;
  metrics: {
    scrollWidth: number;
    viewportWidth: number;
    horizontalOverflow: boolean;
    minFontPx: number | null;
    firstViewText: string;
    ctaInFirstView: boolean;
    navTiming: { domContentLoadedMs: number; loadMs: number; transferBytes: number } | null;
    blockedRequests: number;
  };
}

let chromiumMod: typeof import('playwright-core').chromium | null = null;
let browserPromise: Promise<import('playwright-core').Browser | null> | null = null;
let browserError = '';

export function browserUnavailableReason(): string {
  return browserError;
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      if (process.env.MFS_NO_BROWSER === '1') {
        browserError = 'MFS_NO_BROWSER=1 によりブラウザを使用しない設定';
        return null;
      }
      try {
        chromiumMod ??= (await import('playwright-core')).chromium;
        const tries: Parameters<typeof chromiumMod.launch>[0][] = [];
        if (process.env.BROWSER_PATH) tries.push({ executablePath: process.env.BROWSER_PATH });
        tries.push({ channel: 'msedge' }, { channel: 'chrome' }, {});
        for (const t of tries) {
          try {
            return await chromiumMod.launch({ ...t, headless: true, args: ['--disable-dev-shm-usage'] });
          } catch (e) {
            browserError = String((e as Error).message).split('\n')[0];
          }
        }
        return null;
      } catch (e) {
        browserError = String((e as Error).message);
        return null;
      }
    })();
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const b = await browserPromise;
  browserPromise = null;
  await b?.close().catch(() => {});
}

export async function capturePage(url: string, kind: 'pc' | 'sp', outDir: string, fileName: string, fixturesDir: string): Promise<Capture | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  const width = kind === 'pc' ? 1366 : 390;
  const ctx = await browser.newContext({
    viewport: { width, height: kind === 'pc' ? 800 : 844 },
    deviceScaleFactor: 1,
    isMobile: kind === 'sp',
    hasTouch: kind === 'sp',
    userAgent: kind === 'sp' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) MockFirstSalesBot/0.1' : 'Mozilla/5.0 MockFirstSalesBot/0.1',
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  let blocked = 0;
  try {
    await ctx.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith('data:')) return route.continue();
      try {
        const t = await validateTarget(reqUrl);
        if (t.fixture || isFixtureHost(new URL(reqUrl).hostname)) {
          const f = readFixture(fixturesDir, new URL(reqUrl));
          return route.fulfill({ status: f.status, contentType: f.contentType, body: f.body });
        }
        return route.continue();
      } catch {
        blocked++;
        return route.abort('blockedbyclient');
      }
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(LIMITS.screenshotTimeoutMs);
    await page.goto(url, { waitUntil: 'load', timeout: LIMITS.screenshotTimeoutMs });
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(() => {
      const de = document.documentElement;
      const sizes = Array.from(document.querySelectorAll('p, li, td, a, span')).slice(0, 400).map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((n) => n > 0);
      const vh = window.innerHeight;
      const visible = Array.from(document.querySelectorAll('h1,h2,p,a,button,td,div')).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.top < vh && r.bottom > 0 && r.width > 0;
      });
      const fvText = visible.map((e) => (e.childNodes.length === 1 && e.firstChild?.nodeType === 3 ? e.textContent : '')).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      const cta = Array.from(document.querySelectorAll('a,button')).some((e) => {
        const r = e.getBoundingClientRect();
        return r.top < vh && r.bottom > 0 && /(問い?合|相談|予約|contact|tel:)/i.test((e.textContent || '') + ((e as HTMLAnchorElement).href || ''));
      });
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return {
        scrollWidth: de.scrollWidth,
        viewportWidth: window.innerWidth,
        minFontPx: sizes.length ? Math.min(...sizes) : null,
        firstViewText: fvText,
        ctaInFirstView: cta,
        navTiming: nav ? { domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd), transferBytes: nav.transferSize } : null,
      };
    });
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, fileName), fullPage: true, timeout: LIMITS.screenshotTimeoutMs });
    return {
      kind,
      file: fileName,
      width,
      metrics: { ...metrics, horizontalOverflow: metrics.scrollWidth > metrics.viewportWidth + 4, blockedRequests: blocked },
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** モック（ローカル配信 HTML）を撮影する。外部通信は一切許可しない。 */
export async function captureHtml(htmlContent: string, kind: 'pc' | 'sp', outDir: string, fileName: string): Promise<boolean> {
  const browser = await getBrowser();
  if (!browser) return false;
  const ctx = await browser.newContext({ viewport: { width: kind === 'pc' ? 1366 : 390, height: 844 }, isMobile: kind === 'sp' });
  try {
    await ctx.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    await page.setContent(htmlContent, { waitUntil: 'load' });
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, fileName), fullPage: true });
    return true;
  } finally {
    await ctx.close().catch(() => {});
  }
}
