import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const { chromium } = await import(
  "file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
);

const url = process.env.APP_URL ?? "http://localhost:5173";
const screenshotPath = resolve("artifacts", "ui-check.png");
const browserPaths = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

const executablePath = browserPaths.find((path) => existsSync(path));
const browser = await chromium.launch({
  headless: true,
  executablePath
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

page.on("pageerror", (error) => {
  consoleErrors.push(error.message);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.locator("h1", { hasText: "Halifax Sourced" }).waitFor();

const cardCount = await page.locator(".restaurant-card").count();
if (cardCount < 8) {
  throw new Error(`Expected at least 8 restaurant cards, found ${cardCount}.`);
}

await page.locator("#search").fill("Dartmouth");
const dartmouthCount = await page.locator(".restaurant-card").count();
if (dartmouthCount < 2) {
  throw new Error(`Expected Dartmouth search results, found ${dartmouthCount}.`);
}

await page.locator("#search").fill("");
await page.getByRole("button", { name: "Events" }).click();
const eventCards = await page.locator(".restaurant-card").count();
if (eventCards < 1) {
  throw new Error("Expected at least one event-capable restaurant.");
}

const overlay = await page
  .locator("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")
  .count();
if (overlay > 0) {
  throw new Error("Framework error overlay detected.");
}

if (consoleErrors.length) {
  throw new Error(`Console errors detected:\n${consoleErrors.join("\n")}`);
}

await mkdir("artifacts", { recursive: true });
await page.screenshot({ path: screenshotPath, fullPage: true });
await browser.close();

console.log(`UI verified. Screenshot saved to ${screenshotPath}`);
