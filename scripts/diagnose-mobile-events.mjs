import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${url}/#events`, { waitUntil: "networkidle" });
await page.locator(".event-card").first().waitFor();
await page.waitForTimeout(200);

const diagnostics = await page.evaluate(() => {
  const root = document.documentElement;
  const viewportWidth = root.clientWidth;
  const describe = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const id = node.id ? `#${node.id}` : "";
    const classes = typeof node.className === "string" && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).join(".")}`
      : "";
    return {
      selector: `${node.tagName.toLowerCase()}${id}${classes}`,
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      display: style.display,
      position: style.position,
      overflowX: style.overflowX,
      minWidth: style.minWidth,
      maxWidth: style.maxWidth,
      whiteSpace: style.whiteSpace,
      gridTemplateColumns: style.gridTemplateColumns,
      flexWrap: style.flexWrap
    };
  };

  const all = [...document.querySelectorAll("body *")];
  const outsideViewport = all
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.right > viewportWidth + 2 || rect.left < -2;
    })
    .map(describe)
    .sort((a, b) => (b.right - viewportWidth) - (a.right - viewportWidth))
    .slice(0, 40);

  const internalScrollers = all
    .filter((node) => node.scrollWidth > node.clientWidth + 2)
    .map(describe)
    .sort((a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth))
    .slice(0, 20);

  return {
    viewportWidth,
    rootClientWidth: root.clientWidth,
    rootScrollWidth: root.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflow: root.scrollWidth - root.clientWidth,
    outsideViewport,
    internalScrollers
  };
});

await page.screenshot({ path: resolve("artifacts", "ui-check-events-mobile-diagnostic.png"), fullPage: true });
await writeFile(resolve("artifacts", "mobile-events-overflow.json"), `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
console.log(JSON.stringify(diagnostics, null, 2));

await browser.close();
if (diagnostics.overflow > 2) {
  throw new Error(`Mobile events overflow is ${diagnostics.overflow}px; see artifacts/mobile-events-overflow.json.`);
}
