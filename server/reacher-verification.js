const EARTH_RADIUS_METERS = 6371000;

function calculateDistanceMeters(aLat, aLon, bLat, bLon) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function evaluateArrival(sender, reacher, now, { radiusMeters, maxAgeMs, maxAccuracyMeters }) {
  function valid(location, prefix) {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return `${prefix}_LOCATION_MISSING`;
    const age = now - Date.parse(location.timestamp);
    if (!Number.isFinite(age) || age < -30000 || age > maxAgeMs) return `${prefix}_LOCATION_STALE`;
    if (!Number.isFinite(location.accuracy) || location.accuracy < 0 || location.accuracy > maxAccuracyMeters) return `${prefix}_GPS_INACCURATE`;
    return null;
  }
  const reason = valid(sender, 'SENDER') || valid(reacher, 'REACHER');
  if (reason) return { verified: false, reason, thresholdMeters: radiusMeters, distanceMeters: null };
  const distanceMeters = Math.round(calculateDistanceMeters(sender.lat, sender.lng, reacher.lat, reacher.lng) * 10) / 10;
  // Conservative rule: the measured distance plus both uncertainty radii must fit.
  return { verified: distanceMeters + sender.accuracy + reacher.accuracy <= radiusMeters,
    reason: distanceMeters + sender.accuracy + reacher.accuracy <= radiusMeters ? null : 'TOO_FAR',
    distanceMeters, thresholdMeters: radiusMeters };
}

module.exports = { calculateDistanceMeters, evaluateArrival };
