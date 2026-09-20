const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('three public reports become one authority-only situation feeding existing resource coordination', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resq-situation-'));
  const port = await freePort();
  const key = 'situation-test-key';
  const child = spawn(process.execPath, [path.join(__dirname, 'alert-broadcast-server.js')], {
    env:{ ...process.env, NODE_ENV:'test', PORT:String(port), SAFEGUARD_DATA_DIR:dir, RESQ_AUTHORITY_KEY:key,
      SITUATION_AI_URL:'', SITUATION_AI_API_KEY:'' }, stdio:'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  async function request(route, method='GET', body, authority=false) {
    const response = await fetch(base + route, { method,
      headers:{ 'Content-Type':'application/json', ...(authority ? { 'X-RESQ-Authority-Key':key } : {}) },
      body:body ? JSON.stringify(body) : undefined });
    return { status:response.status, data:await response.json() };
  }
  try {
    let ready = false;
    for (let i=0; i<50; i++) { try { await fetch(base+'/health'); ready=true; break; } catch (_) { await new Promise(resolve=>setTimeout(resolve,100)); } }
    assert.ok(ready);
    assert.equal((await request('/public-situations')).status, 403);
    assert.equal((await request('/public-situations/bad')).status, 403);
    const entries = [
      ['Large landslide has blocked the road.', 11.0168, 76.9558],
      ['People may be trapped near the blocked road.', 11.0183, 76.9570],
      ['Road is completely blocked by mud.', 11.0198, 76.9582],
    ];
    const ids=[];
    for (const [description, latitude, longitude] of entries) {
      const submitted = await request('/public-incidents', 'POST', { incidentType:'LANDSLIDE', severity:'HIGH',
        description, latitude, longitude, demoMode:true });
      assert.equal(submitted.status, 201);
      ids.push(submitted.data.incidentId);
    }
    const situations = await request('/public-situations', 'GET', undefined, true);
    assert.equal(situations.status, 200);
    assert.equal(situations.data.situations.length, 1);
    const picture = situations.data.situations[0];
    assert.equal(picture.reportCount, 3);
    assert.deepEqual(new Set(picture.reportIds), new Set(ids));
    assert.equal(picture.conditions.find(c => c.type === 'PEOPLE_TRAPPED').status, 'POSSIBLE');
    assert.equal(picture.analysisMode, 'RULE_BASED');
    const detail = await request(`/public-incidents/${ids[0]}/situation`, 'GET', undefined, true);
    assert.equal(detail.data.situation.id, picture.id);
    const search = await request(`/public-incidents/${ids[0]}/nearby-resources`, 'GET', undefined, true);
    assert.equal(search.status, 200);
    assert.equal(search.data.situation.reportCount, 3);
    assert.ok(search.data.resources.some(r => r.available && r.matchedNeeds.includes('SEARCH_AND_RESCUE')));
    const available = search.data.resources.find(r => r.available);
    const coordinated = await request(`/public-incidents/${ids[0]}/coordinate`, 'POST', { resourceId:available.id }, true);
    assert.equal(coordinated.status, 200);
    const duplicate = await request('/public-incidents', 'POST', { incidentType:'LANDSLIDE', severity:'HIGH',
      description:entries[0][0], latitude:entries[0][1], longitude:entries[0][2], demoMode:true });
    assert.equal(duplicate.data.duplicate, true);
    const distant = await request('/public-incidents', 'POST', { incidentType:'LANDSLIDE', severity:'HIGH',
      description:'Road blocked far away', latitude:11.2, longitude:76.9, demoMode:true });
    assert.equal(distant.status, 201);
    assert.equal((await request('/public-situations', 'GET', undefined, true)).data.situations.length, 2);
  } finally { child.kill(); fs.rmSync(dir, { recursive:true, force:true }); }
});
