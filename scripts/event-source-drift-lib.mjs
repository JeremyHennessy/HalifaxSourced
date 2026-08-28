const DAY_MS = 24 * 60 * 60 * 1000;

function stamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function eventKey(event) {
  return [
    String(event.id || ""),
    String(event.sourceId || ""),
    String(event.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    String(event.startAt || "")
  ].join("|");
}

function sourceCountMap(payload) {
  const map = new Map();
  for (const stat of payload?.sourceStats || []) {
    if (!stat?.sourceId) continue;
    map.set(stat.sourceId, { ...stat, eventCount: Number(stat.eventCount || 0) });
  }
  return map;
}

function sourceEvents(payload, sourceId) {
  return (payload?.events || []).filter((event) => String(event.sourceId || "") === String(sourceId));
}

export function reconcileEventSourceDrift(current, previous, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const minimumPriorCount = Number(options.minimumPriorCount ?? 20);
  const maxSnapshotAgeDays = Number(options.maxSnapshotAgeDays ?? 3);
  const maxCarryDays = Number(options.maxCarryDays ?? 7);
  const futureDays = Number(options.futureDays ?? 400);
  const previousGeneratedAt = stamp(previous?.generatedAt);
  const snapshotAgeDays = previousGeneratedAt === null ? Infinity : Math.max(0, (now - previousGeneratedAt) / DAY_MS);
  const currentStats = sourceCountMap(current);
  const previousStats = sourceCountMap(previous);
  const anomalies = [];
  const carried = [];
  const existingKeys = new Set((current?.events || []).map(eventKey));
  const maxFuture = now + futureDays * DAY_MS;

  if (snapshotAgeDays > maxSnapshotAgeDays) {
    return {
      payload: { ...current, refreshAnomalies: current?.refreshAnomalies || [] },
      anomalies,
      carried,
      skippedReason: "previous_snapshot_outside_grace_window"
    };
  }

  for (const [sourceId, prior] of previousStats) {
    const currentStat = currentStats.get(sourceId);
    const currentCount = Number(currentStat?.eventCount || 0);
    if (prior.eventCount < minimumPriorCount || currentCount !== 0 || !currentStat) continue;

    const reason = currentStat.status && currentStat.status !== "ok"
      ? `source_status_${currentStat.status}`
      : "zero_yield_after_high_prior_count";
    const anomaly = {
      sourceId,
      sourceName: currentStat.sourceName || prior.sourceName || sourceId,
      reason,
      priorEventCount: prior.eventCount,
      currentEventCount: currentCount,
      previousGeneratedAt: previous.generatedAt || null,
      observedAt: new Date(now).toISOString(),
      carryGraceDays: maxCarryDays,
      carriedForwardCount: 0
    };

    for (const event of sourceEvents(previous, sourceId)) {
      const endAt = stamp(event.endAt || event.startAt);
      const startAt = stamp(event.startAt);
      if (endAt === null || startAt === null || endAt < now - 6 * 60 * 60 * 1000 || startAt > maxFuture) continue;
      const key = eventKey(event);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const carriedEvent = {
        ...event,
        refreshState: "carried_forward_source_yield_anomaly",
        carriedForwardAt: new Date(now).toISOString(),
        carryForwardExpiresAt: new Date(Math.min(endAt + DAY_MS, now + maxCarryDays * DAY_MS)).toISOString(),
        sourceAnomaly: {
          reason,
          previousGeneratedAt: previous.generatedAt || null,
          priorEventCount: prior.eventCount
        }
      };
      carried.push(carriedEvent);
      anomaly.carriedForwardCount += 1;
    }
    anomalies.push(anomaly);
  }

  const events = [...(current?.events || []), ...carried];
  const sourceStats = (current?.sourceStats || []).map((stat) => {
    const anomaly = anomalies.find((item) => item.sourceId === stat.sourceId);
    return anomaly ? { ...stat, status: "yield_anomaly", priorEventCount: anomaly.priorEventCount, carriedForwardCount: anomaly.carriedForwardCount } : stat;
  });
  return {
    payload: {
      ...current,
      events,
      eventCount: events.length,
      sourceStats,
      refreshAnomalies: [...(current?.refreshAnomalies || []), ...anomalies]
    },
    anomalies,
    carried,
    skippedReason: null
  };
}
