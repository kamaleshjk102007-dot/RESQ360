const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

async function freePort() {
  const socket=net.createServer();
  await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  return port;
}

test('public report to authority-only resource search and coordination',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'resq-public-'));
  const port=await freePort();
  const key='test-authority-key';
  const child=spawn(process.execPath,[path.join(__dirname,'alert-broadcast-server.js')],{
    env:{...process.env,NODE_ENV:'test',PORT:String(port),SAFEGUARD_DATA_DIR:dir,RESQ_AUTHORITY_KEY:key},stdio:'ignore',
  });
  const base=`http://127.0.0.1:${port}`;
  async function request(route,method='GET',body,authority=false){
    const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(authority?{'X-RESQ-Authority-Key':key}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  }
  try{
    let ready=false;
    for(let i=0;i<50;i++){try{await fetch(base+'/health');ready=true;break}catch(_){await new Promise(resolve=>setTimeout(resolve,100))}}
    assert.ok(ready);
    assert.equal((await request('/public-incidents')).status,403);
    assert.equal((await request('/public-incidents','POST',{incidentType:'LANDSLIDE',severity:'HIGH',latitude:null,longitude:76.9558})).status,400);
    const report=await request('/public-incidents','POST',{incidentType:'LANDSLIDE',severity:'HIGH',latitude:11.0168,longitude:76.9558,description:'Demo landslide',demoMode:true});
    assert.equal(report.status,201);
    const id=report.data.incidentId;
    assert.equal((await request(`/public-incidents/${id}/nearby-resources`)).status,403);
    assert.equal((await request(`/public-incidents/${id}/coordinate`,'POST',{resourceId:'demo_fire_01'})).status,403);
    assert.equal((await request('/public-incidents')).status,403);
    const list=await request('/public-incidents','GET',undefined,true);
    assert.equal(list.data.incidents.length,1);
    assert.equal(list.data.incidents[0].demoMode,true);
    const search=await request(`/public-incidents/${id}/nearby-resources`,'GET',undefined,true);
    assert.equal(search.status,200);
    assert.equal(search.data.dataSource,'REGISTERED_DEMO_DATA');
    assert.equal(search.data.officialAvailability,false);
    assert.equal(search.data.recommendation.source,'RULE_BASED');
    assert.ok(search.data.resources.find(item=>item.id==='demo_fire_01'));
    assert.equal((await request(`/public-incidents/${id}/coordinate`,'POST',{resourceId:'demo_disaster_01'},true)).status,422);
    const coordinated=await request(`/public-incidents/${id}/coordinate`,'POST',{resourceId:'demo_fire_01'},true);
    assert.equal(coordinated.status,200);
    assert.equal(coordinated.data.action.status,'COORDINATION_INITIATED');
    assert.match(coordinated.data.message,/no agency was automatically dispatched/i);
    const refreshed=await request(`/public-incidents/${id}/nearby-resources`,'GET',undefined,true);
    assert.equal(refreshed.data.incident.coordinationActions.length,1);
    assert.equal((await request('/public-incidents/bad/nearby-resources','GET',undefined,true)).status,404);
    assert.equal((await request('/resources','POST',{name:'fake'},true)).status,404);
    const other=await request('/public-incidents','POST',{incidentType:'OTHER',severity:'LOW',latitude:11.0168,longitude:76.9558});
    const noMatch=await request(`/public-incidents/${other.data.incidentId}/nearby-resources`,'GET',undefined,true);
    assert.deepEqual(noMatch.data.resources,[]);
  } finally {child.kill()}
});
