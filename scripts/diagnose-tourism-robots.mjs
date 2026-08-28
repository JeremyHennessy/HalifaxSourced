const target = "https://novascotia.com/event/festa-italiana-halifax/";
const robotsUrl = "https://novascotia.com/robots.txt";
const response = await fetch(robotsUrl, { headers: { "User-Agent": "HalifaxSourced/0.9 (+https://github.com/JeremyHennessy/HalifaxSourced)" }, signal: AbortSignal.timeout(10000) });
const text = await response.text();
function parseRobotsCurrent(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [], disallow: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    current.hasRules = true;
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const specific = groups.find((group) => group.agents.some((agent) => agent.includes("halifaxsourced")));
  const wildcard = groups.find((group) => group.agents.includes("*"));
  return { groups, selected: specific || wildcard || null, disallow: (specific || wildcard)?.disallow || [] };
}
const parsed = parseRobotsCurrent(text);
const path = new URL(target).pathname;
const blocked = parsed.disallow.some((prefix) => prefix === "/" || (prefix && path.startsWith(prefix)));
console.log(JSON.stringify({ status: response.status, bytes: text.length, targetPath: path, selected: parsed.selected, blocked, groupCount: parsed.groups.length }, null, 2));
console.log("ROBOTS_START");
console.log(text.slice(0, 12000));
console.log("ROBOTS_END");
if (!response.ok) throw new Error(`robots_http_${response.status}`);
