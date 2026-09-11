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
  try {
    playwright = await import("playwright");
  } catch {}
}
if (!playwright?.chromium) {
  throw new Error("Playwright is required for admin status verification. Set PLAYWRIGHT_MODULE if it is installed outside node_modules.");
}

const url = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
const browserPaths = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = browserPaths.find((path) => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
const criticalResourceFailures = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("requestfailed", (request) => {
  const type = request.resourceType();
  if (["document", "script", "xhr", "fetch"].includes(type)) {
    criticalResourceFailures.push(`${type} ${request.url()}: ${request.failure()?.errorText || "request_failed"}`);
  }
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await mkdir("artifacts", { recursive: true });
await page.goto(`${url}/#admin/status`, { waitUntil: "networkidle" });
await page.locator("[data-admin-status-panel]").waitFor();
await page.waitForFunction(() => window.__halifaxAdminStatus?.loaded === true);
const desktopState = await page.evaluate(() => ({
  title: document.querySelector("h1")?.textContent || "",
  metrics: window.__halifaxAdminStatus?.metrics || {},
  metricCards: document.querySelectorAll("[data-admin-status-metric]").length,
  dataRows: document.querySelectorAll("[data-admin-data-row]").length,
  sourceRows: document.querySelectorAll("[data-admin-source-row]").length,
  reviewRows: document.querySelectorAll("[data-admin-review-row]").length,
  reportLinks: document.querySelectorAll("[data-admin-report-link]").length,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
}));

if (!/Freshness and source status/i.test(desktopState.title)) {
  throw new Error(`Expected admin status heading, got ${JSON.stringify(desktopState)}.`);
}
if (desktopState.metricCards < 4 || desktopState.dataRows < 5 || desktopState.sourceRows < 5 || desktopState.reviewRows < 5 || desktopState.reportLinks < 4) {
  throw new Error(`Expected populated admin status dashboard, got ${JSON.stringify(desktopState)}.`);
}
if (!Number.isFinite(desktopState.metrics.sourceFailures) || !Number.isFinite(desktopState.metrics.reviewQueueCount) || desktopState.metrics.sourceRowCount < 5 || desktopState.metrics.reviewRowCount < 5) {
  throw new Error(`Expected status metrics to be exported for tests, got ${JSON.stringify(desktopState.metrics)}.`);
}
if (desktopState.metrics.deployedDataAgeDays !== null && !Number.isFinite(desktopState.metrics.deployedDataAgeDays)) {
  throw new Error(`Expected deployed data age to be numeric or null, got ${JSON.stringify(desktopState.metrics)}.`);
}
if (desktopState.metrics.latestPreviewArtifactAgeDays !== null && !Number.isFinite(desktopState.metrics.latestPreviewArtifactAgeDays)) {
  throw new Error(`Expected preview artifact age to be numeric or null, got ${JSON.stringify(desktopState.metrics)}.`);
}
if (desktopState.overflow > 2) {
  throw new Error(`Expected desktop admin status to fit viewport, got ${JSON.stringify(desktopState)}.`);
}
await page.screenshot({ path: resolve("artifacts", "ui-check-admin-status-desktop.png"), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${url}/#admin/status`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__halifaxAdminStatus?.loaded === true);
const mobileState = await page.evaluate(() => ({
  metricCards: document.querySelectorAll("[data-admin-status-metric]").length,
  dataRows: document.querySelectorAll("[data-admin-data-row]").length,
  sourceRows: document.querySelectorAll("[data-admin-source-row]").length,
  reviewRows: document.querySelectorAll("[data-admin-review-row]").length,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  bottomNavVisible: getComputedStyle(document.querySelector(".mobile-tabbar")).display !== "none"
}));
if (mobileState.metricCards < 4 || mobileState.dataRows < 5 || mobileState.sourceRows < 5 || mobileState.reviewRows < 5 || mobileState.overflow > 2 || !mobileState.bottomNavVisible) {
  throw new Error(`Expected mobile admin status to fit and stay populated, got ${JSON.stringify(mobileState)}.`);
}
await page.screenshot({ path: resolve("artifacts", "ui-check-admin-status-iphone.png"), fullPage: true });

await browser.close();
if (criticalResourceFailures.length) {
  throw new Error(`Critical admin status resource failures detected:\n${criticalResourceFailures.join("\n")}`);
}
if (consoleErrors.length) {
  throw new Error(`Admin status console errors detected:\n${consoleErrors.join("\n")}`);
}
console.log("Admin freshness/status panel verified: report ages, preview artifact age, source failures, review queues, and mobile layout.");
