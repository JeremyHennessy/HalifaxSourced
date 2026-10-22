import integrity from '../../source-integrity.js';
import { fetchGuardedSource, withSourceDeadline } from './fetch-public-source.mjs';

// Project policy, not a claim of full RFC 9309 conformance: no Allow exceptions,
// same-host guarded redirects, and only 404/410 mean an absent policy. Retain
// every legacy denial while adding correct group/path/query matching.
function groupsFrom(text, legacy = false, discoveryLegacy = false) {
  const groups = [];
  let current;
  for (const rawLine of text.split(legacy ? /\r?\n/ : /\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    // Discovery historically skipped nonempty Sitemap records before grouping.
    // Keep that separate projection: a blind parser swap could reopen its denial.
    if (discoveryLegacy && key === 'sitemap' && value) continue;
    if (key === 'user-agent') {
      if (!current || current.hasRules) {
        current = { agents: [], disallow: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      // Non-rule records must not split a modern group. The legacy projection
      // deliberately keeps its old grouping, including unknown records.
      if (legacy || key === 'allow' || key === 'disallow') current.hasRules = true;
      if (key === 'disallow' && value) current.disallow.push(value);
    }
  }
  return groups;
}

// Compare URI octets: decode only percent-encoded ASCII unreserved characters,
// uppercase other escapes, and percent-encode literal non-ASCII UTF-8. Reserved
// escapes remain distinct from their raw delimiters (e.g. %2F is not '/').
function normalizeOctets(value) {
  return Array.from(value, character => /^[A-Za-z0-9]$/.test(character) || "-._~:/?#[]@!$&'()*+,;=%".includes(character) ? character : encodeURIComponent(character))
    .join('')
    .replace(/%([0-9a-f]{2})/gi, (_, hex) => {
      const character = String.fromCharCode(Number.parseInt(hex, 16));
      return /^[A-Za-z0-9._~-]$/.test(character) ? character : `%${hex.toUpperCase()}`;
    });
}

function rulePattern(rule) {
  const anchored = rule.endsWith('$');
  return { anchored, parts: normalizeOctets(anchored ? rule.slice(0, -1) : rule).split('*') };
}

function matchesRule({ parts, anchored }, target) {
  // Literal searches avoid regex metacharacters and exponential backtracking
  // from untrusted patterns containing many '*'. Only '*' and terminal '$'
  // have special meaning; everything else is compared as literal URI octets.
  if (!target.startsWith(parts[0])) return false;
  if (parts.length === 1) return !anchored || target.length === parts[0].length;
  let cursor = parts[0].length;
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index];
    if (anchored && index === parts.length - 1) return target.endsWith(part) && target.length - part.length >= cursor;
    const found = target.indexOf(part, cursor);
    if (found < 0) return false;
    cursor = found + part.length;
  }
  return true;
}

const maximumPolicyBytes = 512 * 1024;
function usableRobotsText(text) {
  if (Buffer.byteLength(text, 'utf8') > maximumPolicyBytes || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(text)) return false;
  let hasContent = false;
  let usableDirective = false;
  let hasAgent = false;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    hasContent = true;
    // HTML challenges and XML/JSON/error documents are not empty policies.
    // Unknown extension records may coexist with usable robots directives,
    // but arbitrary prose, markup and extension-only bodies confer no access.
    const record = line.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i);
    if (!record || /[<>]/.test(line)) return false;
    const key = record[1].toLowerCase();
    const value = record[2].trim();
    if (['error', 'status', 'message'].includes(key)) return false;
    if (key === 'user-agent') {
      if (!/^(?:\*|[a-z_-]+)$/i.test(value)) return false;
      hasAgent = true;
      usableDirective = true;
    } else if (key === 'allow' || key === 'disallow') {
      if (!hasAgent || (value && !value.startsWith('/'))) return false;
    } else if (key === 'sitemap') {
      try { if (!['http:', 'https:'].includes(new URL(value).protocol)) return false; }
      catch { return false; }
      usableDirective = true;
    }
  }
  return !hasContent || usableDirective;
}

export function parseRobotsPolicy(text, productToken = 'HalifaxSourced') {
  const source = String(text ?? '');
  if (!usableRobotsText(source)) return { state: 'unavailable' };
  const wanted = productToken.toLowerCase();
  const groups = groupsFrom(source);
  const specific = groups.filter(group => group.agents.includes(wanted));
  const selected = specific.length ? specific : groups.filter(group => group.agents.includes('*'));
  const legacyGroups = groupsFrom(source, true);
  const legacySpecific = legacyGroups.find(group => group.agents.some(agent => agent.includes(wanted)));
  const legacyWildcard = legacyGroups.find(group => group.agents.includes('*'));
  const discoveryGroups = groupsFrom(source, true, true);
  const discoverySpecific = discoveryGroups.find(group => group.agents.some(agent => agent.includes(wanted)));
  const discoveryWildcard = discoveryGroups.find(group => group.agents.includes('*'));
  // Only a fully qualified policy can supply metadata. Never expose partial or
  // challenge-body declarations, and never fetch declared sitemap destinations.
  const sitemaps = [...new Set(source.split(/\r\n|\r|\n/).flatMap(line => {
    const match = line.replace(/#.*$/, '').trim().match(/^sitemap\s*:\s*(.+)$/i);
    return match ? [new URL(match[1].trim()).href] : [];
  }))];
  return {
    state: 'parsed',
    disallow: selected.flatMap(group => group.disallow).map(rulePattern),
    legacyDisallow: (legacySpecific || legacyWildcard)?.disallow ?? [],
    discoveryLegacyDisallow: (discoverySpecific || discoveryWildcard)?.disallow ?? [],
    sitemaps
  };
}

export function robotsPolicyAllows(policy, url, { preserveDiscoveryDenials = false } = {}) {
  if (!integrity.safeSource(url)) return false;
  if (policy?.state === 'absent') return true;
  if (policy?.state !== 'parsed') return false;
  const parsed = new URL(url);
  // Tightening-only: even a formerly literal '*' or '$', or an erroneously
  // selected NotHalifaxSourced group, must not reopen a legacy-denied path.
  if (policy.legacyDisallow.some(prefix => prefix === '/' || parsed.pathname.startsWith(prefix))) return false;
  if (preserveDiscoveryDenials && policy.discoveryLegacyDisallow?.some(prefix => prefix === '/' || parsed.pathname.startsWith(prefix))) return false;
  const target = normalizeOctets(parsed.pathname + parsed.search);
  return !policy.disallow.some(pattern => matchesRule(pattern, target));
}

export function createRobotsPolicy({ userAgent, productToken = 'HalifaxSourced', timeoutMs = 8000 } = {}) {
  const cache = new Map();
  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 8000) : 8000;
  return async function robotsFor(url) {
    if (!integrity.safeSource(url)) return { state: 'unavailable' };
    const parsed = new URL(url);
    if (!cache.has(parsed.origin)) {
      // Cache the in-flight promise and failures for this run. No retries, even
      // on 429, timeout, rejected redirects or a failed/stalled response body.
      cache.set(parsed.origin, withSourceDeadline(async signal => {
        const response = await fetchGuardedSource(new URL('/robots.txt', parsed.origin), {
          headers: { 'User-Agent': userAgent }, redirect: 'manual', signal
        });
        if (response.status === 404 || response.status === 410) return { state: 'absent' };
        if (response.status !== 200) return { state: 'unavailable' };
        const contentType = (response.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (contentType && contentType !== 'text/plain') return { state: 'unavailable' };
        if (Number(response.headers?.get('content-length')) > maximumPolicyBytes) return { state: 'unavailable' };
        const text = await response.text();
        if (typeof text !== 'string') return { state: 'unavailable' };
        return parseRobotsPolicy(text, productToken);
      }, deadlineMs).catch(() => ({ state: 'unavailable' })));
    }
    return cache.get(parsed.origin);
  };
}

// Preserve the callback API for existing adapters. Discovery additionally uses
// the same policy retrieval for sitemap metadata and its own legacy denial union.
export function createRobotsAllows(options = {}) {
  const robotsFor = createRobotsPolicy(options);
  return async url => robotsPolicyAllows(await robotsFor(url), url);
}
