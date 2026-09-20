const test = require('node:test');
const assert = require('node:assert/strict');
const { findRelatedSituation, buildSituation, evidenceFor, constrainSituationAI } = require('./situation-intelligence');
const { rankResources } = require('./resource-matching');

const first = { id:'PI-1', situationId:'SI-1', incidentType:'LANDSLIDE', severity:'HIGH', latitude:11.0168,
  longitude:76.9558, description:'Large landslide has blocked the road.', createdAt:'2026-09-19T10:00:00.000Z', demoMode:true };
const report = (overrides={}) => ({ ...first, id:'PI-2', situationId:undefined, latitude:11.018, longitude:76.957,
  description:'People may be trapped near the blocked road.', createdAt:'2026-09-19T10:04:00.000Z', ...overrides });

test('nearby timely same-event report joins; far, old, different-type and unrelated reports do not', () => {
  assert.equal(findRelatedSituation(report(), [first], 1, 30), 'SI-1');
  assert.equal(findRelatedSituation(report({ latitude:11.1 }), [first], 1, 30), null);
  assert.equal(findRelatedSituation(report({ createdAt:'2026-09-19T12:00:00.000Z' }), [first], 1, 30), null);
  assert.equal(findRelatedSituation(report({ incidentType:'FIRE' }), [first], 1, 30), null);
  assert.equal(findRelatedSituation(report({ description:'Fire at a school' }), [first], 1, 30), null);
  assert.equal(findRelatedSituation(report({ latitude:NaN }), [first], 1, 30), null);
});

test('situation center, evidence, severity and needs evolve across three reports', () => {
  const third = report({ id:'PI-3', situationId:'SI-1', latitude:11.019,
    description:'Road is completely blocked by mud.', createdAt:'2026-09-19T10:07:00.000Z' });
  const situation = buildSituation([first, report({ situationId:'SI-1' }), third]);
  assert.equal(situation.reportCount, 3);
  assert.notEqual(situation.centerLatitude, first.latitude);
  assert.equal(situation.severity, 'HIGH');
  assert.equal(situation.confidenceLabel, 'HIGH');
  assert.ok(situation.severityReasons.includes('Multiple related reports'));
  assert.deepEqual(situation.conditions.find(c => c.type === 'PEOPLE_TRAPPED').status, 'POSSIBLE');
  assert.deepEqual(situation.conditions.find(c => c.type === 'ROAD_BLOCKAGE').status, 'REPORTED');
  for (const need of ['SEARCH_AND_RESCUE', 'FIRE_RESCUE', 'MEDICAL', 'ROAD_CLEARANCE']) assert.ok(situation.responseNeeds.includes(need));
  assert.match(situation.summary, /may be trapped/i);
  assert.equal(situation.analysisMode, 'RULE_BASED');
});

test('one report and empty/noisy descriptions remain safe', () => {
  assert.equal(buildSituation([first]).reportCount, 1);
  assert.deepEqual(evidenceFor(report({ description:'' })).conditions, []);
  assert.deepEqual(evidenceFor(report({ description:'No people trapped' })).conditions, []);
  assert.equal(buildSituation([report({ description:'' })]).conditions.length, 0);
});

test('medical and road clearance evidence is retained as reported, not confirmed', () => {
  const picture = buildSituation([report({ description:'Injured person; road closed' })]);
  assert.ok(picture.responseNeeds.includes('MEDICAL'));
  assert.ok(picture.responseNeeds.includes('ROAD_CLEARANCE'));
  assert.equal(picture.conditions.find(c => c.type === 'INJURY').status, 'REPORTED');
});

test('AI output cannot invent IDs, conditions or needs, or promote possible to reported', () => {
  const picture = buildSituation([first, report({ situationId:'SI-1' })]);
  const valid = { incidentType:'LANDSLIDE', severityAssessment:'HIGH', severityConfidence:0.8,
    reportIds:['PI-1','PI-2'], conditions:picture.conditions, responseNeeds:picture.responseNeeds };
  assert.equal(constrainSituationAI(picture, valid).analysisMode, 'AI_ASSISTED');
  assert.equal(constrainSituationAI(picture, { ...valid, reportIds:['FAKE'] }), null);
  assert.equal(constrainSituationAI(picture, { ...valid, responseNeeds:['SPACE_FORCE'] }), null);
  assert.equal(constrainSituationAI(picture, { ...valid, conditions:[{type:'PEOPLE_TRAPPED',status:'REPORTED'}] }), null);
  assert.equal(constrainSituationAI(picture, { ...valid, severityConfidence:2 }), null);
  assert.equal(constrainSituationAI(picture, 'invalid'), null);
});

test('situation response needs influence existing resource ranker', () => {
  const picture = buildSituation([first, report({ situationId:'SI-1' })]);
  const resources = [
    { id:'search', name:'Search', type:'SEARCH_AND_RESCUE', latitude:11.018, longitude:76.957, capabilities:['SEARCH_AND_RESCUE'], status:'AVAILABLE', available:true },
    { id:'medical', name:'Medical', type:'AMBULANCE', latitude:11.018, longitude:76.957, capabilities:['MEDICAL'], status:'AVAILABLE', available:true },
  ];
  const ranked = rankResources({ ...picture, latitude:picture.centerLatitude, longitude:picture.centerLongitude }, resources, 10);
  assert.equal(ranked.length, 2);
  assert.ok(ranked.find(r => r.id === 'search').matchedNeeds.includes('SEARCH_AND_RESCUE'));
  assert.ok(ranked.find(r => r.id === 'medical').matchedNeeds.includes('MEDICAL'));
});
