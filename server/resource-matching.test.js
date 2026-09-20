const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDistanceMeters } = require('./reacher-verification');
const { rankResources, fallbackRecommendation, constrainAIRecommendation } = require('./resource-matching');

const incident = { incidentType:'LANDSLIDE', severity:'HIGH', latitude:11.0168, longitude:76.9558 };
const resource = (id, latitude, capabilities, status='AVAILABLE') => ({ id, name:id, type:'FIRE_RESCUE', latitude,
  longitude:76.9558, capabilities, status, available:status==='AVAILABLE' });

test('Haversine measures nearby locations in meters', () => assert.ok(calculateDistanceMeters(11,76,11.001,76)>110));
test('resources within radius are found and outside radius excluded', () => {
  const found = rankResources(incident, [resource('near',11.02,['LANDSLIDE']),resource('far',12,['LANDSLIDE'])],10);
  assert.deepEqual(found.map(item=>item.id),['near']);
});
test('incident capability matching excludes irrelevant units', () => {
  assert.equal(rankResources(incident,[resource('irrelevant',11.02,['FIRE'])],10).length,0);
  assert.deepEqual(rankResources(incident,[resource('rescue',11.02,['RESCUE','LANDSLIDE'])],10)[0].matchingCapabilities,['RESCUE','LANDSLIDE']);
});
test('available matching units rank before equally capable busy units', () => {
  const ranked=rankResources(incident,[resource('busy',11.017,['LANDSLIDE'],'BUSY'),resource('available',11.03,['LANDSLIDE'])],10);
  assert.deepEqual(ranked.map(item=>item.id),['available','busy']);
});
test('multiple relevant resource types can match', () => {
  assert.equal(rankResources(incident,[resource('fire',11.02,['LANDSLIDE']),resource('medical',11.03,['MEDICAL']),resource('police',11.04,['SECURITY'])],10).length,3);
});
test('no match gives empty list and no invented fallback resource', () => {
  const ranked=rankResources(incident,[resource('fire-only',11.02,['FIRE'])],10);
  assert.deepEqual(ranked,[]);
  assert.deepEqual(fallbackRecommendation(incident,ranked).recommendedResourceIds,[]);
});
test('invalid or missing incident GPS rejects search', () => {
  assert.throws(()=>rankResources({...incident,latitude:200},[],10),/INCIDENT_LOCATION_MISSING/);
  assert.throws(()=>rankResources({...incident,latitude:null},[],10),/INCIDENT_LOCATION_MISSING/);
});
test('malformed and duplicate resource IDs cannot create duplicate results', () => {
  const a=resource('same',11.02,['LANDSLIDE']);
  assert.equal(rankResources(incident,[null,{...a,latitude:'bad'},a,a],10).length,1);
});
test('AI selection is constrained to factual available IDs and server-written explanation', () => {
  const ranked=rankResources(incident,[resource('fire',11.02,['LANDSLIDE'])],10);
  const good=constrainAIRecommendation(ranked,{recommendedResourceIds:['fire'],reason:'Invented helicopter dispatched'});
  assert.deepEqual(good.recommendedResourceIds,['fire']);
  assert.ok(!good.reason.includes('helicopter'));
  assert.equal(constrainAIRecommendation(ranked,{recommendedResourceIds:['unknown']}),null);
});
test('AI unavailable falls back to transparent deterministic ranking', () => {
  const ranked=rankResources(incident,[resource('fire',11.02,['LANDSLIDE'])],10);
  assert.equal(fallbackRecommendation(incident,ranked).source,'RULE_BASED');
});
test('all matching resources unavailable produces no available recommendation', () => {
  const ranked=rankResources(incident,[resource('busy',11.02,['LANDSLIDE'],'BUSY')],10);
  assert.equal(ranked.length,1);
  assert.deepEqual(fallbackRecommendation(incident,ranked).recommendedResourceIds,[]);
});
test('malformed resource collection is treated as empty', () => {
  assert.deepEqual(rankResources(incident,{bad:true},10),[]);
});
