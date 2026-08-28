import { chromium } from "playwright";

const url = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack || error.message}`));

await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
await page.locator("#exploreMiniMap.leaflet-container").waitFor();
await page.waitForTimeout(100);

async function rerenderWithSort(value) {
  const oldMap = await page.locator("#exploreMiniMap").elementHandle();
  if (!oldMap) throw new Error("Explore mini-map missing before rerender.");
  const before = await oldMap.evaluate((node) => ({
    connected: node.isConnected,
    leafletId: node._leaflet_id ?? null
  }));
  if (!before.connected || before.leafletId === null) {
    throw new Error(`Expected initialized connected mini-map before rerender: ${JSON.stringify(before)}`);
  }

  await page.selectOption("#sortFilter", value);
  await page.locator("#exploreMiniMap.leaflet-container").waitFor();
  await page.waitForTimeout(100);

  const after = await oldMap.evaluate((node) => ({
    connected: node.isConnected,
    leafletId: node._leaflet_id ?? null
  }));
  await oldMap.dispose();
  if (after.connected || after.leafletId !== null) {
    throw new Error(`Detached Explore mini-map retained Leaflet state after rerender: ${JSON.stringify(after)}`);
  }
}

await rerenderWithSort("name");
await rerenderWithSort("fresh");
await rerenderWithSort("recommended");

const liveMaps = await page.locator("#exploreMiniMap.leaflet-container").count();
if (liveMaps !== 1) throw new Error(`Expected exactly one live Explore mini-map, found ${liveMaps}.`);
if (errors.length) throw new Error(`Browser errors detected:\n${errors.join("\n")}`);

console.log("Explore mini-map lifecycle: 3/3 rerenders destroyed detached Leaflet maps cleanly; browser errors=0.");
await browser.close();
