const SOURCE_LOCAL_TIME_ZONES = new Map([
  // This owner calendar publishes the visible Halifax wall clock with mixed
  // UTC and UTC-5 offsets. Preserve its displayed local time in Atlantic time.
  ["durtynellys.ca", "America/Halifax"]
]);

const formatterByTimeZone = new Map();

function sourceHost(value) {
  try {
    return new URL(String(value ?? "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatterFor(timeZone) {
  if (!formatterByTimeZone.has(timeZone)) {
    formatterByTimeZone.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }));
  }
  return formatterByTimeZone.get(timeZone);
}

function offsetAt(instant, timeZone) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const represented = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return represented - Math.trunc(instant / 1000) * 1000;
}

export function localWallTimeToIso(value, timeZone) {
  const match = String(value ?? "").trim().match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/
  );
  if (!match) return null;
  const milliseconds = Number((match[7] ?? "").padEnd(3, "0"));
  const wallClock = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
    milliseconds
  );
  let instant = wallClock;
  for (let index = 0; index < 4; index += 1) {
    const next = wallClock - offsetAt(instant, timeZone);
    if (next === instant) break;
    instant = next;
  }
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

export function normalizeEventDateForSource(value, sourceUrl) {
  const raw = String(value ?? "").trim();
  const timeZone = SOURCE_LOCAL_TIME_ZONES.get(sourceHost(sourceUrl));
  if (timeZone) {
    const localized = localWallTimeToIso(raw, timeZone);
    if (localized) return localized;
  }
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}
