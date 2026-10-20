import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "halifax-symphony-headings-"));
try {
  await mkdir(join(root, "scripts", "lib"), { recursive: true });
  await mkdir(join(root, "data", "build"), { recursive: true });
  await copyFile(new URL("./import-supplemental-city-events.mjs", import.meta.url), join(root, "scripts", "import-supplemental-city-events.mjs"));
  const fixture = `
    <h3>Choose a concert by&hellip;</h3>
    <div><a href="?season=2025-2026">Season 2025-2026</a></div>
    <h3 class="concert"><a href="/concerts/alex-cuba/"><span>Alex Cuba</span> &amp; Symphony Nova Scotia</a></h3>
    <p>7:30 pm &bull; Friday, October 23, 2026</p><div>Rebecca Cohn</div>
    <h3><a href="/concerts/multiple/">Two Performances</a></h3>
    <p>7:30 pm • Friday, November 27, 2026</p><div>Rebecca Cohn</div>
    <p>2:00 pm • Saturday, November 28, 2026</p><div>Rebecca Cohn</div>
    <h3>Unlinked navigation</h3>
    <a href="/not-a-concert/">Not a concert</a>
    <p>8:00 pm • Monday, November 30, 2026</p><div>Rebecca Cohn</div>
    <h3><a href="/concerts/outside/">Outside Halifax</a></h3>
    <p>7:30 pm • Friday, December 4, 2026</p><div>Truro</div>
    <h3><a href="/concerts/past/">Expired concert</a></h3>
    <p>7:30 pm • Thursday, October 15, 2026</p><div>Rebecca Cohn</div>
    <h3><a href="/concerts/beyond/">Beyond horizon</a></h3>
    <p>7:30 pm • Sunday, November 28, 2027</p><div>Rebecca Cohn</div>`;
  // Match the site's entity decoding without introducing a network dependency.
  const html = fixture.replaceAll("&bull;", "&#8226;");
  await writeFile(join(root, "scripts", "lib", "fetch-public-source.mjs"), `
    export async function fetchGuardedSource(url) {
      if (url !== "https://symphony.example/concerts/") throw new Error("Unexpected network target");
      return new Response(${JSON.stringify(html)}, { headers: { "content-type": "text/html" } });
    }
  `);
  await writeFile(join(root, "data", "event-source-supplements.json"), JSON.stringify({
    sources: [{ id: "symphony-nova-scotia", name: "Symphony Nova Scotia", kind: "official_arts_calendar", mode: "symphony_concerts", url: "https://symphony.example/concerts/" }]
  }));
  const unrelated = { id: "keep", sourceId: "other", title: "Keep unrelated event", startAt: "2026-10-22T22:30:00.000Z", endAt: "2026-10-22T22:30:00.000Z", venueName: "Another venue", city: "Halifax", categories: ["Arts"] };
  await writeFile(join(root, "data", "build", "city-events.json"), JSON.stringify({
    range: { start: "2026-10-20T00:00:00.000Z", end: "2027-11-24T23:59:59.999Z" },
    events: [unrelated, { ...unrelated, id: "bad-season", sourceId: "symphony-nova-scotia", title: "Season 2025-2026" }],
    sourceStats: [], failures: []
  }));
  for (let run = 0; run < 2; run += 1) {
    const result = spawnSync(process.execPath, [join(root, "scripts", "import-supplemental-city-events.mjs")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(await readFile(join(root, "data", "build", "city-events.json"), "utf8"));
    assert.equal(output.events.length, 4);
    assert.deepEqual(output.events.find(event => event.id === "keep"), unrelated);
    const first = output.events.find(event => event.title === "Alex Cuba & Symphony Nova Scotia");
    assert(first, "First concert must not be swallowed by an unlinked filter heading");
    assert.equal(first.id, "symphony-nova-scotia-648004b43df2a1b3");
    assert.equal(first.eventUrl, "https://symphony.example/concerts/alex-cuba/");
    assert.equal(first.startAt, "2026-10-23T22:30:00.000Z");
    assert.deepEqual(output.events.filter(event => event.title === "Two Performances").map(event => event.startAt), [
      "2026-11-27T23:30:00.000Z", "2026-11-28T18:00:00.000Z"
    ]);
    assert(!output.events.some(event => /Season|Unlinked|Outside|Expired|Beyond|Not a concert/.test(event.title)));
    assert.equal(output.sourceStats[0].eventCount, 3);
    assert.deepEqual(output.failures, []);
  }
  console.log("Symphony heading regression passed: first concert survives navigation, dates remain isolated, range/venue guards and rerun replacement hold.");
} finally {
  await rm(root, { recursive: true, force: true });
}
