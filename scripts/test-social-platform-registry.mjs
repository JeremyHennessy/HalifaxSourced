import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "halifax-social-registry-"));
const scriptsDir = join(root, "scripts");
const dataDir = join(root, "data");
const buildDir = join(dataDir, "build");
await mkdir(scriptsDir, { recursive: true });
await mkdir(buildDir, { recursive: true });
await copyFile(new URL("./sanitize-first-party-sources.mjs", import.meta.url), join(scriptsDir, "sanitize-first-party-sources.mjs"));
await copyFile(new URL("../data/social-platform-registry.json", import.meta.url), join(dataDir, "social-platform-registry.json"));

const observedAt = "2026-08-28T12:00:00.000Z";
const fixture = {
  version: 3,
  generatedAt: observedAt,
  records: [
    {
      restaurantId: "bar-sophia",
      name: "Bar Sophia",
      website: "https://barsophia.example/",
      socialProfiles: [
        { platform: "facebook", handle: "pages", url: "https://www.facebook.com/pages/Bar-Sophia/111", profileUrl: "https://www.facebook.com/pages/Bar-Sophia/111", associationBasis: "linked_from_official_website", confidence: "authoritative", reviewState: "verified_link", observedAt, lastVerifiedAt: observedAt, status: "active" },
        { platform: "instagram", handle: "p", url: "https://www.instagram.com/p/ABC123/", profileUrl: "https://www.instagram.com/p/ABC123/", associationBasis: "linked_from_official_website", confidence: "authoritative", reviewState: "verified_link", observedAt, lastVerifiedAt: observedAt, status: "active" },
        { platform: "youtube", handle: "abcd1234", url: "https://youtu.be/abcd1234", profileUrl: "https://youtu.be/abcd1234", associationBasis: "linked_from_official_website", confidence: "authoritative", reviewState: "verified_link", observedAt, lastVerifiedAt: observedAt, status: "active" },
        { platform: "snapchat", handle: "barsophia", url: "https://www.snapchat.com/add/barsophia", profileUrl: "https://www.snapchat.com/add/barsophia", associationBasis: "linked_from_official_website", confidence: "authoritative", reviewState: "verified_link", observedAt, lastVerifiedAt: observedAt, status: "active" }
      ],
      linkHubs: [
        { platform: "linktree", platformKind: "link_hub", handle: "barsophia", url: "https://linktr.ee/barsophia", profileUrl: "https://linktr.ee/barsophia", associationBasis: "linked_from_official_website", confidence: "authoritative", reviewState: "verified_link", observedAt, lastVerifiedAt: observedAt, status: "active" }
      ],
      relatedLinks: []
    },
    {
      restaurantId: "lockside-canteen",
      name: "Lockside Canteen",
      website: "https://lockside.example/",
      socialProfiles: [
        { platform: "facebook", handle: "pg", url: "https://www.facebook.com/pg/LeMonDogsLemonade/reviews", profileUrl: "https://www.facebook.com/pg/LeMonDogsLemonade/reviews", associationBasis: "linked_from_official_website", confidence: "authoritative", reviewState: "verified_link", observedAt, lastVerifiedAt: observedAt, status: "active" }
      ],
      linkHubs: [],
      relatedLinks: []
    },
    {
      restaurantId: "black-sheep",
      name: "Black Sheep Restaurant",
      website: "https://blacksheep.example/",
      socialProfiles: [
        { platform: "facebook", handle: "people", url: "https://www.facebook.com/people/Black-Sheep-Restaurant/222", profileUrl: "https://www.facebook.com/people/Black-Sheep-Restaurant/222", associationBasis: "linked_from_official_website", confidence: "authoritative", reviewState: "verified_link", observedAt, lastVerifiedAt: observedAt, status: "active" }
      ],
      linkHubs: [],
      relatedLinks: []
    }
  ]
};
await writeFile(join(buildDir, "first-party-sources.json"), JSON.stringify(fixture, null, 2));

const result = await new Promise((resolve) => {
  const child = spawn(process.execPath, [join(scriptsDir, "sanitize-first-party-sources.mjs")], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (code) => resolve({ code, stdout, stderr }));
});
if (result.code !== 0) throw new Error(`Sanitizer fixture failed (${result.code}): ${result.stderr || result.stdout}`);

const output = JSON.parse(await readFile(join(buildDir, "first-party-sources.json"), "utf8"));
const bar = output.records.find((record) => record.restaurantId === "bar-sophia");
const lockside = output.records.find((record) => record.restaurantId === "lockside-canteen");
const blackSheep = output.records.find((record) => record.restaurantId === "black-sheep");

function assert(condition, message) { if (!condition) throw new Error(message); }
assert(bar.socialProfiles.some((profile) => profile.platform === "facebook" && profile.handle === "Bar-Sophia"), "Expected legacy Facebook /pages URL to normalize to the page name.");
assert(!bar.socialProfiles.some((profile) => profile.platform === "instagram"), "Instagram /p/ content URL must not survive as a profile.");
assert(!bar.socialProfiles.some((profile) => profile.platform === "youtube"), "youtu.be content shortlink must not survive as a YouTube profile.");
assert(bar.socialProfiles.some((profile) => profile.platform === "snapchat" && profile.handle === "barsophia"), "Snapchat /add/<handle> profile should remain valid.");
assert(bar.linkHubs.length === 1 && bar.linkHubs[0].platform === "linktree", "Linktree must remain a link hub rather than a social network profile.");
assert(lockside.socialProfiles[0]?.handle === "LeMonDogsLemonade", "Expected Facebook /pg/ handle normalization.");
assert(lockside.socialProfiles[0]?.url === "https://www.facebook.com/LeMonDogsLemonade", "Expected Facebook /pg/ content tab to canonicalize to the base profile URL.");
assert(lockside.socialProfiles[0]?.sharedBrandProfile === true && lockside.socialProfiles[0]?.associationBasis === "shared_brand_profile", "Name-mismatched legacy page should be explicitly treated as a shared/related brand profile.");
assert(blackSheep.socialProfiles[0]?.handle === "Black-Sheep-Restaurant", "Expected Facebook /people/ handle normalization.");
assert(output.sanitization?.normalizedFacebookLegacyProfiles === 3, `Expected 3 normalized Facebook profiles, got ${output.sanitization?.normalizedFacebookLegacyProfiles}.`);
assert(output.sanitization?.removedGenericOrInvalidProfiles === 2, `Expected 2 invalid content profiles removed, got ${output.sanitization?.removedGenericOrInvalidProfiles}.`);

console.log("Social platform registry regression passed: legacy Facebook paths normalize, generic content links are rejected, Snapchat remains valid, and link hubs stay separate.");
await rm(root, { recursive: true, force: true });
