const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDistanceMeters, evaluateArrival } = require('./reacher-verification');

const now = Date.now();
const config = { radiusMeters: 150, maxAgeMs: 60000, maxAccuracyMeters: 50 };
const sender = { lat: 11, lng: 76, accuracy: 5, timestamp: new Date(now).toISOString() };
const reacher = { lat: 11.0001, lng: 76, accuracy: 5, timestamp: new Date(now).toISOString() };

test('Haversine distance is zero at same point and approximately 111 m per .001 latitude', () => {
  assert.equal(calculateDistanceMeters(11, 76, 11, 76), 0);
  assert.ok(Math.abs(calculateDistanceMeters(11, 76, 11.001, 76) - 111.2) < 1);
});
test('inside threshold verifies', () => assert.equal(evaluateArrival(sender, reacher, now, config).verified, true));
test('outside threshold remains unverified', () => assert.equal(evaluateArrival(sender, { ...reacher, lat: 11.01 }, now, config).reason, 'TOO_FAR'));
test('missing sender location is rejected', () => assert.equal(evaluateArrival(null, reacher, now, config).reason, 'SENDER_LOCATION_MISSING'));
test('missing reacher location is rejected', () => assert.equal(evaluateArrival(sender, null, now, config).reason, 'REACHER_LOCATION_MISSING'));
test('stale sender location is rejected', () => assert.equal(evaluateArrival({ ...sender, timestamp: new Date(now - 61000).toISOString() }, reacher, now, config).reason, 'SENDER_LOCATION_STALE'));
test('stale reacher location is rejected', () => assert.equal(evaluateArrival(sender, { ...reacher, timestamp: new Date(now - 61000).toISOString() }, now, config).reason, 'REACHER_LOCATION_STALE'));
test('poor sender or reacher GPS is rejected', () => {
  assert.equal(evaluateArrival({ ...sender, accuracy: 100 }, reacher, now, config).reason, 'SENDER_GPS_INACCURATE');
  assert.equal(evaluateArrival(sender, { ...reacher, accuracy: 100 }, now, config).reason, 'REACHER_GPS_INACCURATE');
});
test('moving sender changes verification result', () => {
  assert.equal(evaluateArrival(sender, reacher, now, config).verified, true);
  assert.equal(evaluateArrival({ ...sender, lat: 11.01 }, reacher, now, config).verified, false);
});
test('GPS uncertainty cannot turn a marginal location into verified arrival', () => {
  const nearBoundary = { ...reacher, lat: 11.00125, accuracy: 10 };
  assert.equal(evaluateArrival(sender, nearBoundary, now, config).verified, false);
});
