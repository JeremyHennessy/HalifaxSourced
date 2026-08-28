import { existsSync } from "node:fs";

let playwright;
try { playwright = await import("playwright"); } catch {}
if (!playwright?.chromium) throw new Error("Playwright is required.");
const url = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/usr/bin/chromium"].filter(Boolean).find((path) => existsSync(path));

const htmlResponse = await fetch(`${url}/`);
const rawHtml = await htmlResponse.text();
const expected = ["app-place-facts.js", "app-place-facts-display.js", "app-structured-specials.js", "app-rich-search.js", "app-home-rich.js"];
console.log(JSON.stringify({
  rawStatus: htmlResponse.status,
  rawLength: rawHtml.length,
  expectedInRawHtml: Object.fromEntries(expected.map((name) => [name, rawHtml.includes(name)])),
  rawScriptTail: [...rawHtml.matchAll(/<script\s+src=["']([^"']+)["']/g)].map((m) => m[1]).slice(-20)
}, null, 2));

const browser = await playwright.chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const requests = [];
const responses = [];
const pageErrors = [];
page.on("request", (request) => { if (/\.js(?:\?|$)/.test(request.url())) requests.push(request.url()); });
page.on("response", (response) => { if (/\.js(?:\?|$)/.test(response.url())) responses.push({ status: response.status(), url: response.url() }); });
page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
page.on("console", (message) => { if (message.type() === "error") pageErrors.push(`console: ${message.text()}`); });
await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
const atNetworkIdle = await page.evaluate(() => ({
  readyState: document.readyState,
  htmlLength: document.documentElement.outerHTML.length,
  scriptSrcs: [...document.scripts].map((script) => script.src),
  structuredFactCount: window.__halifaxStructuredPlaceFactCount ?? null,
  structuredSpecialCount: window.__halifaxStructuredSpecialCount ?? null,
  rawStructuredPayloadCount: window.HALIFAX_STRUCTURED_PLACE_FACTS?.records?.length ?? null,
  rawSpecialPayloadCount: window.HALIFAX_STRUCTURED_SPECIALS?.records?.length ?? null,
  adapters: {
    mergeActionLinks: typeof mergeActionLinks,
    homeRichSections: typeof homeRichSections,
    searchableText: typeof searchableText
  }
}));
console.log("NETWORK_IDLE_STATE=" + JSON.stringify(atNetworkIdle, null, 2));

let waitOutcome = "resolved";
try {
  await page.waitForFunction(() => window.__halifaxStructuredPlaceFactCount > 0 && typeof homeRichSections === "function", null, { timeout: 5000 });
} catch (error) {
  waitOutcome = `timeout:${error.message}`;
}
const afterWait = await page.evaluate(() => ({
  readyState: document.readyState,
  scriptSrcs: [...document.scripts].map((script) => script.src),
  structuredFactCount: window.__halifaxStructuredPlaceFactCount ?? null,
  structuredSpecialCount: window.__halifaxStructuredSpecialCount ?? null,
  adapters: {
    mergeActionLinks: typeof mergeActionLinks,
    homeRichSections: typeof homeRichSections,
    searchableText: typeof searchableText
  }
}));
console.log("WAIT_OUTCOME=" + waitOutcome);
console.log("AFTER_WAIT_STATE=" + JSON.stringify(afterWait, null, 2));
console.log("JS_REQUESTS=" + JSON.stringify(requests, null, 2));
console.log("JS_RESPONSES=" + JSON.stringify(responses, null, 2));
console.log("PAGE_ERRORS=" + JSON.stringify(pageErrors, null, 2));

const missingDomTags = expected.filter((name) => !afterWait.scriptSrcs.some((src) => src.includes(name)));
const missingRequests = expected.filter((name) => !requests.some((src) => src.includes(name)));
console.log("MISSING_DOM_TAGS=" + JSON.stringify(missingDomTags));
console.log("MISSING_REQUESTS=" + JSON.stringify(missingRequests));
await browser.close();
if (!rawHtml.includes("app-place-facts.js")) throw new Error("Raw server HTML does not include expected adapter scripts.");
if (missingDomTags.length || missingRequests.length || pageErrors.length || !(afterWait.structuredFactCount > 0) || afterWait.adapters.homeRichSections !== "function") process.exit(2);
