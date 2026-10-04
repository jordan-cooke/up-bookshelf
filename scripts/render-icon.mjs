// Rasterize the existing vector emblem for container dashboards that need PNG.
// Use a separate Playwright installation, optionally via PLAYWRIGHT_MODULE.
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
  const svg = await fs.readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:256px;height:256px}</style>${svg}`);
  await page.screenshot({ path: fileURLToPath(new URL("../public/icon.png", import.meta.url)), omitBackground: true });
} finally { await browser.close(); }
