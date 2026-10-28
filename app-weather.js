"use strict";

const WEATHER_OFFICIAL_HALIFAX = "https://weather.gc.ca/en/location/index.html?coords=44.65,-63.6";
const WEATHER_OFFICIAL_SHEARWATER = "https://weather.gc.ca/en/location/index.html?coords=44.67,-63.56";
const WEATHER_LICENCE = "https://eccc-msc.github.io/open-data/licence/readme_en/";
let weatherViewRefreshTimer = null;

function weatherTime(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Halifax", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short"
  }).format(new Date(value));
}

function weatherTimeMarkup(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  return '<time datetime="' + escapeHtml(value) + '" title="' + escapeHtml(value) + '">' + escapeHtml(weatherTime(value)) + '</time>';
}

function weatherNumber(value, unit) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-CA", { maximumFractionDigits: 3 }).format(value) + unit
    : "Not available";
}

function weatherOfficialUrl(value) {
  return [WEATHER_OFFICIAL_HALIFAX, WEATHER_OFFICIAL_SHEARWATER].includes(value) ? value : WEATHER_OFFICIAL_HALIFAX;
}

function weatherSourceLink(value, label = "View official forecast ↗") {
  return '<a href="' + escapeHtml(weatherOfficialUrl(value)) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>';
}

function weatherStatus(value) {
  return ["fresh", "stale"].includes(value) ? value : "unavailable";
}

function weatherStatusBadge(value) {
  const status = weatherStatus(value);
  const labels = { fresh: "Within freshness limit", stale: "Stale recorded data", unavailable: "Unavailable" };
  return '<span class="weather-status weather-status-' + status + '">' + labels[status] + '</span>';
}

function weatherWarningMarkup(warnings = {}) {
  const status = warnings.status;
  let heading = "Warning status unavailable";
  let detail = "We cannot establish the current warning status from this recorded snapshot. Check the official ECCC pages for the latest information.";
  if (status === "none_reported") {
    heading = "No warnings listed at the recorded check";
    detail = "No warnings were listed in the checked ECCC Halifax city pages at the time below. This is not an all-HRM or all-hazards all-clear.";
  } else if (status === "notice") {
    heading = "Official weather notice listed";
    detail = "An official notice was present in the checked city-page data. Read the original ECCC notice for its exact wording, affected area and validity; this page does not summarize or reinterpret it.";
  }
  return '<section class="weather-warning" aria-labelledby="weatherWarningHeading"><h2 id="weatherWarningHeading">' + heading + '</h2><p>' + detail + '</p><dl class="weather-clocks"><div><dt>Recorded warning check</dt><dd>' + weatherTimeMarkup(warnings.checkedAt) + '</dd></div>' + (Array.isArray(warnings.sourceUpdatedAts) ? warnings.sourceUpdatedAts : []).map((stamp, index) => '<div><dt>City-page update ' + (index + 1) + '</dt><dd>' + weatherTimeMarkup(stamp) + '</dd></div>').join("") + '</dl><p class="weather-links">' + weatherSourceLink(WEATHER_OFFICIAL_HALIFAX, "ECCC Halifax ↗") + weatherSourceLink(WEATHER_OFFICIAL_SHEARWATER, "ECCC Halifax (Shearwater) ↗") + '</p></section>';
}

function weatherObservationMarkup(observation) {
  const status = weatherStatus(observation.status);
  const canShow = status !== "unavailable";
  const field = key => canShow ? observation[key] : null;
  return '<article class="weather-station"><div class="weather-card-heading"><h3>' + escapeHtml(observation.stationName || "Named station unavailable") + '</h3>' + weatherStatusBadge(status) + '</div><p class="weather-station-role">Airport observation — not a neighbourhood reading or forecast.</p><p class="weather-temperature">' + escapeHtml(weatherNumber(field("temperatureC"), "°C")) + '</p><dl class="weather-measures"><div><dt>Wind</dt><dd>' + escapeHtml(weatherNumber(field("windSpeedKmh"), " km/h")) + (canShow && observation.windDirection ? ' · ' + escapeHtml(observation.windDirection) : '') + '</dd></div><div><dt>Gust</dt><dd>' + escapeHtml(weatherNumber(field("windGustKmh"), " km/h")) + '</dd></div><div><dt>Humidity</dt><dd>' + escapeHtml(weatherNumber(field("relativeHumidityPercent"), "%")) + '</dd></div><div><dt>Pressure</dt><dd>' + escapeHtml(weatherNumber(field("pressureKpa"), " kPa")) + '</dd></div></dl><dl class="weather-clocks"><div><dt>Observed</dt><dd>' + weatherTimeMarkup(observation.observedAt) + '</dd></div><div><dt>Source updated</dt><dd>' + weatherTimeMarkup(observation.sourceUpdatedAt) + '</dd></div><div><dt>Retrieved</dt><dd>' + weatherTimeMarkup(observation.retrievedAt) + '</dd></div></dl>' + (status === "stale" ? '<p class="weather-stale-note">Historical reading retained for context; not current conditions.</p>' : '') + weatherSourceLink(observation.sourceUrl, "View official station page ↗") + '</article>';
}

function weatherHourlyMarkup(hourly, status, nowMs) {
  const rows = (Array.isArray(hourly) ? hourly : []).filter(row => row && typeof row.validAt === "string" && Number.isFinite(Date.parse(row.validAt)) && (status !== "fresh" || Date.parse(row.validAt) >= nowMs));
  if (!rows.length) return '<p class="weather-empty">No ' + (status === "fresh" ? 'future ' : '') + 'hourly forecast values are available in this record.</p>';
  return '<div class="weather-table-scroll" tabindex="0" role="region" aria-label="Hourly forecast table, scroll horizontally if needed"><table class="weather-hourly"><caption>' + (status === "fresh" ? 'Upcoming hourly values from the recorded forecast' : 'Historical hourly forecast values — not a current forecast') + '</caption><thead><tr><th scope="col">Valid time · Halifax</th><th scope="col">Air temperature</th><th scope="col">Condition</th><th scope="col">Precipitation chance</th><th scope="col">Wind</th><th scope="col">Gust</th></tr></thead><tbody>' + rows.map(row => '<tr><th scope="row">' + weatherTimeMarkup(row.validAt) + '</th><td>' + escapeHtml(weatherNumber(row.temperatureC, "°C")) + '</td><td>' + escapeHtml(row.condition || "Not available") + '</td><td>' + escapeHtml(weatherNumber(row.precipitationProbabilityPercent, "%")) + '</td><td>' + escapeHtml(weatherNumber(row.windSpeedKmh, " km/h")) + (row.windDirection ? ' · ' + escapeHtml(row.windDirection) : '') + '</td><td>' + escapeHtml(weatherNumber(row.windGustKmh, " km/h")) + '</td></tr>').join("") + '</tbody></table></div>';
}

function weatherForecastMarkup(result = {}, nowMs) {
  const status = weatherStatus(result.status);
  const forecast = result.data;
  if (!forecast || status === "unavailable") return '<section class="weather-panel"><h2>Regional forecast unavailable</h2><p>No usable regional forecast is available in the accepted record. This is not a forecast of clear weather.</p>' + weatherSourceLink(WEATHER_OFFICIAL_HALIFAX) + '</section>';
  const periods = Array.isArray(forecast.periods) ? forecast.periods : [];
  const lead = periods[0] ? '<div class="weather-forecast-lead"><h3>' + escapeHtml(periods[0].publisherPeriodLabel) + ' · original forecast period</h3><p>' + escapeHtml(periods[0].summary) + '</p></div>' : '';
  return '<section class="weather-panel" aria-labelledby="weatherForecastHeading"><div class="weather-card-heading"><h2 id="weatherForecastHeading">Official regional forecast</h2>' + weatherStatusBadge(status) + '</div><p>Halifax Metro and Halifax County West — one ECCC regional product, not separate neighbourhood predictions or certified whole-municipality coverage.</p>' + (status === "stale" ? '<p class="weather-stale-note">This forecast is stale. Original forecast values and clocks are retained below; do not use it as a current forecast.</p>' : '') + lead + weatherSourceLink(forecast.sourceUrl) + '<dl class="weather-clocks"><div><dt>Regional forecast issued</dt><dd>' + weatherTimeMarkup(forecast.issuedAt) + '</dd></div><div><dt>Hourly forecast issued</dt><dd>' + weatherTimeMarkup(forecast.hourlyIssuedAt) + '</dd></div><div><dt>Source updated</dt><dd>' + weatherTimeMarkup(forecast.sourceUpdatedAt) + '</dd></div><div><dt>Hourly valid range</dt><dd>' + weatherTimeMarkup(forecast.hourlyValidFrom) + ' to ' + weatherTimeMarkup(forecast.hourlyValidThrough) + '</dd></div></dl>' + weatherHourlyMarkup(result.hourly || forecast.hourly, status, nowMs) + (periods.length ? '<details class="weather-periods" data-weather-periods><summary>Original regional forecast periods</summary><p>Publisher labels belong to the issue time above. They are not advanced to today, and exact daily start/end times are not supplied.</p><div class="weather-period-grid">' + periods.map(period => '<article><h3>' + escapeHtml(period.publisherPeriodLabel || "Publisher period") + '</h3><p>' + escapeHtml(period.summary || "Summary unavailable") + '</p></article>').join("") + '</div></details>' : '') + weatherSourceLink(forecast.sourceUrl) + '</section>';
}

function weatherPageMarkup(envelope, evaluated, nowMs) {
  const result = evaluated || {};
  const observations = Array.isArray(result.observations) ? result.observations : [];
  const attempt = envelope?.lastAttempt || {};
  const lastAttempt = { success: "Recorded request succeeded", failed: "Latest request failed — previous data retained", pending: "Latest request incomplete — freshness not established", held: "Source held — previous data retained", partial: "Latest response incomplete — previous data retained", not_modified: "Source unchanged (HTTP 304) — original data clocks retained" }[attempt.status] || "No completed request is established";
  return '<section class="page-shell page-intro weather-intro"><div><span class="eyebrow">Reviewed weather sources · Halifax</span><h1>Halifax weather</h1><p>Halifax-only model comparison, official regional guidance and named airport observations, with original source times visible.</p></div>' + weatherSourceLink(WEATHER_OFFICIAL_HALIFAX, "Latest on ECCC ↗") + '</section><div class="page-shell weather-page"><p class="weather-attempt-state" role="status">' + lastAttempt + ' · saved response ' + weatherTimeMarkup(result.retrievedAt) + '</p>' + weatherWarningMarkup(result.warnings) + (typeof weatherModelsMarkup === 'function' ? weatherModelsMarkup(window.HalifaxWeatherModels, nowMs) : '') + weatherForecastMarkup(result.forecast, nowMs) + '<details class="weather-record-note"><summary>' + (envelope?.activation === 'reviewed_refresh' ? 'Saved official weather · source and request details' : 'Recorded manual snapshot · no automatic refresh') + '</summary><p>This page reads a reviewed, saved ECCC response. It makes no weather API requests. Freshness is checked locally while this view is open; a saved response is not a realtime feed.</p><dl class="weather-clocks"><div><dt>Snapshot retrieved</dt><dd>' + weatherTimeMarkup(result.retrievedAt) + '</dd></div><div><dt>Latest request</dt><dd>' + lastAttempt + '</dd></div><div><dt>Request attempted</dt><dd>' + weatherTimeMarkup(attempt.attemptedAt) + '</dd></div><div><dt>Request completed</dt><dd>' + weatherTimeMarkup(attempt.completedAt) + '</dd></div></dl><p>Times use America/Halifax, including ADT/AST daylight-saving changes. Temperatures are °C. No improved prediction accuracy or calibrated neighbourhood forecast is claimed.</p></details><section class="weather-observations" aria-labelledby="weatherObservationHeading"><h2 id="weatherObservationHeading">Named airport observations</h2><p>These are supporting station readings, not conditions measured at Halifax Peninsula, Bedford or Dartmouth.</p><div class="weather-station-grid">' + (observations.length ? observations.map(weatherObservationMarkup).join("") : '<p class="weather-empty">Station observations are unavailable.</p>') + '</div></section><section class="weather-attribution"><h2>Source &amp; limits</h2><p><strong>Data Source: Environment and Climate Change Canada</strong> · <a href="' + WEATHER_LICENCE + '" target="_blank" rel="noopener noreferrer">Data-service licence ↗</a></p><p>' + weatherSourceLink(WEATHER_OFFICIAL_HALIFAX, "Official Halifax source ↗") + ' · ' + weatherSourceLink(WEATHER_OFFICIAL_SHEARWATER, "Official Halifax (Shearwater) source ↗") + '</p><p>Reused with attribution; no ECCC endorsement is implied. Official warnings remain authoritative. This snapshot is not a complete hazards service.</p></section></div>';
}

function clearWeatherViewRefresh() {
  if (weatherViewRefreshTimer !== null) clearTimeout(weatherViewRefreshTimer);
  weatherViewRefreshTimer = null;
}

function weatherFreshnessKey(evaluated, nowMs) {
  return JSON.stringify({
    retrievedAt: evaluated?.retrievedAt,
    models: typeof weatherModelFreshnessKey === 'function' ? weatherModelFreshnessKey(window.HalifaxWeatherModels, nowMs) : null,
    forecast: evaluated?.forecast?.status,
    observations: (evaluated?.observations || []).map(item => item.status),
    warnings: evaluated?.warnings?.status,
    futureHours: evaluated?.forecast?.status === "fresh" ? (evaluated.forecast.hourly || []).filter(item => Date.parse(item.validAt) >= nowMs).map(item => item.validAt) : []
  });
}

function scheduleWeatherViewRefresh(previousKey) {
  weatherViewRefreshTimer = setTimeout(() => {
    weatherViewRefreshTimer = null;
    if (route().name !== "weather") return;
    const nowMs = Date.now();
    let next;
    try { next = window.HalifaxWeatherContract?.evaluate(window.HalifaxWeather, nowMs); } catch { next = null; }
    // Do not rebuild the live region, reset horizontal scroll or disrupt focus
    // every tick when nothing has changed. This is only local clock evaluation.
    if (weatherFreshnessKey(next, nowMs) !== previousKey) renderWeather();
    else scheduleWeatherViewRefresh(previousKey);
  }, 30000);
}

function renderWeather() {
  clearWeatherViewRefresh();
  const nowMs = Date.now();
  const periodOpen = Boolean(document.querySelector('[data-weather-periods]')?.open);
  const modelDetailsOpen = new Set(Array.from(document.querySelectorAll?.('[data-weather-model-details]') || []).filter(node => node.open).map(node => node.getAttribute('data-weather-model-details')));
  let evaluated;
  try { evaluated = window.HalifaxWeatherContract?.evaluate(window.HalifaxWeather, nowMs); } catch { evaluated = null; }
  appView.innerHTML = weatherPageMarkup(window.HalifaxWeather, evaluated, nowMs);
  const details = document.querySelector('[data-weather-periods]');
  if (details && periodOpen) details.open = true;
  for (const node of Array.from(document.querySelectorAll?.('[data-weather-model-details]') || [])) {
    if (modelDetailsOpen.has(node.getAttribute('data-weather-model-details'))) node.open = true;
  }
  scheduleWeatherViewRefresh(weatherFreshnessKey(evaluated, nowMs));
}
