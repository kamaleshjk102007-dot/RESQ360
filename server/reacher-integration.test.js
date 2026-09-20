const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const sender = 'ExponentPushToken[sender1]';
const responder = 'ExponentPushToken[responder1]';
const second = 'ExponentPushToken[responder2]';
const stamp = () => new Date().toISOString();

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('SOS through response, live GPS, verification and protected help', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resq-arrival-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, 'alert-broadcast-server.js')], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), SAFEGUARD_DATA_DIR: dir, REACHER_ARRIVAL_RADIUS_METERS: '50' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  async function post(route, body) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { await fetch(base + '/health'); ready = true; break; } catch (_) { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'server started');
    await post('/register-token', { token: sender, lat: 11, lng: 76 });
    const created = await post('/broadcast-sos', { lat: 11, lng: 76, accuracy: 5, locationTimestamp: stamp(), senderToken: sender });
    assert.equal(created.status, 200);
    const alertId = created.data.alert.id;
    await post('/register-token', { token: responder, lat: 11, lng: 76 });
    await post('/register-token', { token: second, lat: 11, lng: 76 });
    assert.equal((await post('/verify-arrival', { alertId, responderToken: responder, lat: 11, lng: 76 })).status, 403);
    assert.equal((await post('/request-more-help', { alertId, responderToken: responder })).status, 403);
    assert.equal((await post('/acknowledge-sos', { alertId, responderToken: responder })).status, 200);
    assert.equal((await post('/update-responder-location', { alertId, responderToken: second, lat: 11, lng: 76, accuracy: 5, locationTimestamp: stamp() })).status, 403);
    assert.equal((await post('/verify-arrival', { alertId, responderToken: responder })).data.reason, 'REACHER_LOCATION_MISSING');
    assert.equal((await post('/update-responder-location', { alertId, responderToken: responder, lat: 11, lng: 76, accuracy: 5, locationTimestamp: new Date(Date.now() - 120000).toISOString() })).status, 400);
    await post('/update-responder-location', { alertId, responderToken: responder, lat: 11, lng: 76, accuracy: 100, locationTimestamp: stamp() });
    assert.equal((await post('/verify-arrival', { alertId, responderToken: responder })).data.reason, 'REACHER_GPS_INACCURATE');
    await post('/update-responder-location', { alertId, responderToken: responder, lat: 11.01, lng: 76, accuracy: 5, locationTimestamp: stamp() });
    const tooFar = await post('/verify-arrival', { alertId, responderToken: responder, lat: 11, lng: 76 });
    assert.equal(tooFar.data.reason, 'TOO_FAR');
    assert.equal((await post('/request-more-help', { alertId, responderToken: responder })).status, 403);
    await post('/update-sos-location', { alertId, senderToken: sender, lat: 11.01, lng: 76, accuracy: 5, locationTimestamp: stamp() });
    const verified = await post('/verify-arrival', { alertId, responderToken: responder });
    assert.equal(verified.data.verified, true);
    assert.equal(verified.data.arrival.senderLocation.lat, 11.01);
    assert.equal((await post('/verify-arrival', { alertId, responderToken: responder })).data.verified, true);
    assert.equal((await post('/verify-arrival', { alertId, responderToken: second })).status, 403);
    assert.equal((await post('/request-more-help', { alertId, responderToken: second })).status, 403);
    assert.equal((await post('/acknowledge-sos', { alertId, responderToken: second })).status, 200);
    await post('/update-responder-location', { alertId, responderToken: second, lat: 11.02, lng: 76, accuracy: 5, locationTimestamp: stamp() });
    assert.equal((await post('/verify-arrival', { alertId, responderToken: second })).data.reason, 'TOO_FAR');
    assert.equal((await post('/request-more-help', { alertId, responderToken: second })).status, 403);
    const status = await fetch(`${base}/alert-status?id=${alertId}`).then(r => r.json());
    assert.equal(status.alert.verifiedArrivals.length, 1);
    assert.equal(status.alert.arrivalAttempts.length, 2);
    assert.equal((await post('/request-more-help', { alertId, responderToken: responder })).status, 200);
    assert.equal((await post('/resolve-sos', { alertId, senderToken: sender })).status, 200);
    assert.equal((await post('/verify-arrival', { alertId, responderToken: responder })).status, 409);
    assert.equal((await post('/request-more-help', { alertId, responderToken: responder })).status, 409);
  } finally {
    child.kill();
  }
});
