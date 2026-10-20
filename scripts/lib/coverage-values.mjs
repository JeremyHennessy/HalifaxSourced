export function validCoordinates(value) {
  const lat = value?.lat ?? value?.latitude;
  const lon = value?.lon ?? value?.lng ?? value?.longitude;
  return lat !== null && lat !== undefined && lat !== '' && lon !== null && lon !== undefined && lon !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180;
}
export function isUpcoming(startAt, endAt, now = Date.now()) {
  const end = Date.parse(endAt || startAt || '');
  return Number.isFinite(end) && end >= now - 30 * 60 * 1000;
}
export function placeFactCounts(records) {
  return Object.fromEntries([['records', records.length], ...['hours','phone','email','address','features','menus','reservations','ordering'].map(field => [field, records.filter(row => Array.isArray(row[field]) ? row[field].length > 0 : Boolean(row[field])).length])]);
}
