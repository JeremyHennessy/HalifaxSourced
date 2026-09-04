import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const candidates = [
  process.env.PLAYWRIGHT_MODULE,
  "file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
  "file:///root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
].filter(Boolean);

let playwright;
for (const candidate of candidates) {
  try {
    if (candidate.startsWith("file://") && !existsSync(new URL(candidate))) continue;
    playwright = await import(candidate);
    break;
  } catch {}
}
if (!playwright) {
  try { playwright = await import("playwright"); } catch {}
}
if (!playwright?.chromium) throw new Error("Playwright is required for iPhone link verification. Set PLAYWRIGHT_MODULE if needed.");

const url = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
const browserPaths = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = browserPaths.find((path) => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, executablePath });
const iPhone = playwright.devices?.["iPhone 14"] || playwright.devices?.["iPhone 13"] || {
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
};
const context = await browser.newContext({ ...iPhone, acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await mkdir("artifacts", { recursive: true });

const auditSelectors = [
  ".mobile-tabbar a",
  ".mobile-tabbar button",
  "[data-mobile-more-sheet] a",
  ".mobile-more-sheet a",
  ".button",
  ".source-link-row",
  ".sidebar-link",
  ".card-social a",
  ".save-button",
  ".row-save",
  ".event-card>.button",
  ".special-actions .text-link",
  ".map-result-row>a",
  ".map-result-row button",
  ".pagination button",
  ".chip",
  ".map-chips button",
  "[data-event-category]",
  "[data-event-window]",
  "[data-save-event-id]",
  "[data-event-calendar]",
  "[data-filter-apply]"
];

async function capture(name) {
  await page.locator(".toast").evaluateAll((nodes) => nodes.forEach((node) => node.remove())).catch(() => {});
  await page.screenshot({ path: resolve("artifacts", `iphone-link-audit-${name}.png`), fullPage: true });
}

async function auditRoute(name) {
  await page.waitForTimeout(150);
  const result = await page.evaluate((selectors) => {
    const selector = selectors.join(",");
    const elements = [...document.querySelectorAll(selector)];
    const visible = elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && style.pointerEvents !== "none" && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    });
    const smallTargets = [];
    const blockedTargets = [];
    for (const element of visible) {
      const rect = element.getBoundingClientRect();
      const label = (element.textContent || element.getAttribute("aria-label") || element.getAttribute("href") || element.className || element.tagName).trim().replace(/\s+/g, " ").slice(0, 90);
      if (rect.width < 44 || rect.height < 44) {
        smallTargets.push({ label, selector: element.tagName.toLowerCase(), width: Math.round(rect.width), height: Math.round(rect.height) });
      }
      const x = Math.min(Math.max(rect.left + rect.width / 2, 1), innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
      const topmost = document.elementFromPoint(x, y);
      if (topmost && topmost !== element && !element.contains(topmost) && !topmost.contains(element)) {
        blockedTargets.push({ label, topmost: (topmost.textContent || topmost.className || topmost.tagName).trim().replace(/\s+/g, " ").slice(0, 90) });
      }
    }
    const tabbar = document.querySelector(".mobile-tabbar")?.getBoundingClientRect();
    const lowerFixedOverlaps = [...document.querySelectorAll("body *")].filter((element) => {
      if (element.closest(".mobile-tabbar,.toast-region,[data-mobile-more-sheet],.mobile-more-sheet,.mobile-more-backdrop")) return false;
      const style = getComputedStyle(element);
      if (style.position !== "fixed" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return false;
      const rect = element.getBoundingClientRect();
      return tabbar && rect.width > 0 && rect.height > 0 && rect.bottom > tabbar.top + 1 && rect.top < tabbar.bottom - 1;
    }).map((element) => (element.textContent || element.className || element.tagName).trim().replace(/\s+/g, " ").slice(0, 90));
    const unsafeExternalLinks = [...document.querySelectorAll('main a[href^="http"]')].filter((link) => link.target !== "_blank" || !String(link.rel).includes("noreferrer")).map((link) => link.href);
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      visibleCount: visible.length,
      smallTargets,
      blockedTargets,
      lowerFixedOverlaps,
      unsafeExternalLinks,
      viewport: { width: innerWidth, height: innerHeight }
    };
  }, auditSelectors);
  if (result.overflow > 2) throw new Error(`${name}: horizontal overflow ${result.overflow}px in ${JSON.stringify(result.viewport)}.`);
  if (result.smallTargets.length) throw new Error(`${name}: touch targets below 44px: ${JSON.stringify(result.smallTargets.slice(0, 12))}`);
  if (result.blockedTargets.length) throw new Error(`${name}: center taps intercepted: ${JSON.stringify(result.blockedTargets.slice(0, 12))}`);
  if (result.lowerFixedOverlaps.length) throw new Error(`${name}: fixed elements overlap the iPhone tab bar: ${JSON.stringify(result.lowerFixedOverlaps)}`);
  if (result.unsafeExternalLinks.length) throw new Error(`${name}: external links without safe new-tab attributes: ${JSON.stringify(result.unsafeExternalLinks.slice(0, 12))}`);
  await capture(name);
}

async function gotoRoute(hash, waitSelector) {
  await page.goto(`${url}/${hash}`, { waitUntil: "networkidle" });
  if (waitSelector) await page.locator(waitSelector).first().waitFor({ state: "visible" });
}

await gotoRoute("#home", ".mobile-tabbar");
await auditRoute("home");

await page.locator('.mobile-tabbar [data-route-link="explore"]').tap();
await page.waitForURL(/#explore/);
await page.locator(".restaurant-card").first().waitFor({ state: "visible" });
await auditRoute("explore-tab");

const firstDetailHref = await page.locator('.restaurant-card h3 a[href^="#restaurant/"]').first().getAttribute("href");
if (!firstDetailHref) throw new Error("Explore did not expose a restaurant detail link on iPhone.");
await gotoRoute(firstDetailHref, ".restaurant-hero");
await auditRoute("detail");

await page.locator('.mobile-tabbar [data-route-link="events"]').tap();
await page.waitForURL(/#events/);
await page.locator(".event-card,.rich-event-card,.event-filter-panel").first().waitFor({ state: "visible" });
await auditRoute("events-tab");

await page.locator('.mobile-tabbar [data-route-link="map"]').tap();
await page.waitForURL(/#map/);
await page.locator("#mainMap,.map-result-row").first().waitFor({ state: "visible" });
await page.waitForTimeout(800);
await auditRoute("map-tab");

await page.locator("#mobileMore").tap();
await page.locator("[data-mobile-more-sheet]").waitFor({ state: "visible" });
await auditRoute("more-sheet");
const moreLinks = await page.locator("[data-mobile-more-sheet] a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
for (const expected of ["#specials", "#menus", "#saved", "#explore?feature=opening"]) {
  if (!moreLinks.includes(expected)) throw new Error(`Mobile More menu is missing ${expected}: ${JSON.stringify(moreLinks)}`);
}

await page.locator('[data-mobile-more-sheet] a[href="#specials"]').tap();
await page.waitForURL(/#specials/);
await page.locator(".special-card,.empty-state").first().waitFor({ state: "visible" });
await auditRoute("specials-more-link");

await page.locator("#mobileMore").tap();
await page.locator('[data-mobile-more-sheet] a[href="#menus"]').tap();
await page.waitForURL(/#menus/);
await page.locator(".restaurant-card,.empty-state").first().waitFor({ state: "visible" });
await auditRoute("menus-more-link");

await page.locator("#mobileMore").tap();
await page.locator('[data-mobile-more-sheet] a[href="#saved"]').tap();
await page.waitForURL(/#saved/);
await page.locator(".restaurant-card,.empty-state").first().waitFor({ state: "visible" });
await auditRoute("saved-more-link");

await page.setViewportSize({ width: 390, height: 667 });
await gotoRoute("#restaurant/field-guide", ".closure-notice");
await auditRoute("short-iphone-detail");

if (consoleErrors.length) throw new Error(`Console errors detected during iPhone link audit:\n${consoleErrors.join("\n")}`);
await context.close();
await browser.close();
console.log("Halifax Sourced iPhone link audit verified mobile routes, More links, tap targets, safe external targets, and tab-bar collision checks.");
