const { calculateDistanceMeters } = require('./reacher-verification');
const { INCIDENT_TYPES, SEVERITIES, validCoordinates } = require('./resource-matching');

const CONDITION_TYPES = ['ROAD_BLOCKAGE', 'PEOPLE_TRAPPED', 'INJURY', 'FIRE', 'FLOOD', 'STRUCTURAL_DAMAGE'];
const RESPONSE_NEEDS = ['FIRE_RESCUE', 'SEARCH_AND_RESCUE', 'MEDICAL', 'ROAD_CLEARANCE', 'POLICE_SUPPORT', 'WATER_RESCUE'];
const BASE_NEEDS = {
  FIRE: ['FIRE_RESCUE'], ACCIDENT: ['MEDICAL'], FLOOD: ['WATER_RESCUE'],
  LANDSLIDE: ['FIRE_RESCUE', 'SEARCH_AND_RESCUE'], MEDICAL: ['MEDICAL'],
  BUILDING_COLLAPSE: ['SEARCH_AND_RESCUE', 'FIRE_RESCUE'], MISSING_PERSON: ['SEARCH_AND_RESCUE'], OTHER: [],
};
const PATTERNS = [
  ['ROAD_BLOCKAGE', /\b(?:road|street|highway|bridge)\b.{0,40}\b(?:block(?:ed|ing|age)?|closed|impassable)|\b(?:block(?:ed|ing)?|closed)\b.{0,40}\b(?:road|street|highway|bridge)\b/i],
  ['PEOPLE_TRAPPED', /\b(?:trapp(?:ed|ing)?|stuck|buried)\b/i],
  ['INJURY', /\b(?:injur(?:ed|y|ies)|bleeding|wounded|medical help)\b/i],
  ['FIRE', /\b(?:fire|flames|burning)\b/i],
  ['FLOOD', /\b(?:flood|flooding|submerged)\b/i],
  ['STRUCTURAL_DAMAGE', /\b(?:building|structure|wall)\b.{0,30}\b(?:collaps(?:ed|e)|damag(?:ed|e))\b/i],
];
const ANCHORS = ['road', 'bridge', 'building', 'river', 'hill', 'school', 'hospital', 'junction', 'railway', 'house', 'street', 'highway'];

function evidenceFor(report) {
  const description = String(report.description || '').toLowerCase();
  const conditions = [];
  for (const [type, pattern] of PATTERNS) {
    const match = pattern.exec(description);
    if (!match) continue;
    const before = description.slice(Math.max(0, match.index - 35), match.index);
    if (/\b(?:no|not|without|false report of)\s+(?:\w+\s+){0,3}$/.test(before)) continue;
    const context = description.slice(Math.max(0, match.index - 35), match.index + match[0].length);
    const possible = /\b(?:may|might|possibly|possible|could|suspected|unconfirmed)\b/.test(context);
    conditions.push({ type, status: possible ? 'POSSIBLE' : 'REPORTED', reportIds: [report.id] });
  }
  return { conditions, anchors: ANCHORS.filter(word => new RegExp(`\\b${word}\\b`).test(description)) };
}

function groupedReports(incidents) {
  const groups = new Map();
  for (const report of incidents) {
    const id = report.situationId || report.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(report);
  }
  return groups;
}

function findRelatedSituation(report, incidents, radiusKm, windowMinutes) {
  if (!validCoordinates(report.latitude, report.longitude)) return null;
  const candidates = [];
  for (const [id, members] of groupedReports(incidents)) {
    const compatible = members.filter(item => item.incidentType === report.incidentType && item.demoMode === report.demoMode &&
      validCoordinates(item.latitude, item.longitude) && Number.isFinite(Date.parse(item.createdAt)) &&
      Math.abs(Date.parse(report.createdAt) - Date.parse(item.createdAt)) <= windowMinutes * 60000);
    for (const item of compatible) {
      const distance = calculateDistanceMeters(report.latitude, report.longitude, item.latitude, item.longitude);
      if (distance > radiusKm * 1000) continue;
      const left = evidenceFor(report), right = evidenceFor(item);
      const sharedAnchor = left.anchors.some(anchor => right.anchors.includes(anchor));
      const sharedCondition = left.conditions.some(a => right.conditions.some(b => a.type === b.type));
      // Same category and close position alone do not establish the same event.
      if (!sharedAnchor && !sharedCondition && !(distance <= 75 && (!report.description || !item.description))) continue;
      candidates.push({ id, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.id || null;
}

function buildSituation(reports) {
  if (!reports.length) return null;
  const ordered = [...reports].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const coordinates = ordered.filter(r => validCoordinates(r.latitude, r.longitude));
  const evidence = ordered.map(report => ({ report, ...evidenceFor(report) }));
  const conditionMap = new Map();
  for (const entry of evidence) for (const condition of entry.conditions) {
    const previous = conditionMap.get(condition.type);
    conditionMap.set(condition.type, { type: condition.type,
      status: previous?.status === 'REPORTED' || condition.status === 'REPORTED' ? 'REPORTED' : 'POSSIBLE',
      reportIds: [...new Set([...(previous?.reportIds || []), entry.report.id])] });
  }
  const conditions = [...conditionMap.values()];
  const has = type => conditions.some(c => c.type === type);
  const responseNeeds = new Set(BASE_NEEDS[ordered[0].incidentType] || []);
  if (has('PEOPLE_TRAPPED')) { responseNeeds.add('SEARCH_AND_RESCUE'); responseNeeds.add('MEDICAL'); }
  if (has('INJURY')) responseNeeds.add('MEDICAL');
  if (has('ROAD_BLOCKAGE')) responseNeeds.add('ROAD_CLEARANCE');
  if (has('FIRE')) responseNeeds.add('FIRE_RESCUE');
  if (has('FLOOD')) responseNeeds.add('WATER_RESCUE');
  const submittedSeverity = ordered.reduce((max, r) => Math.max(max, SEVERITIES.indexOf(r.severity)), 0);
  const reasons = [`Highest reporter-selected severity: ${SEVERITIES[submittedSeverity]}`];
  let severityIndex = submittedSeverity;
  if (ordered.length >= 2) { reasons.push('Multiple related reports'); severityIndex = Math.max(severityIndex, 1); }
  if (has('PEOPLE_TRAPPED')) { reasons.push('People possibly or reportedly trapped'); severityIndex = Math.max(severityIndex, 2); }
  if (has('INJURY')) { reasons.push('Injury mentioned in reports'); severityIndex = Math.max(severityIndex, 2); }
  if (has('ROAD_BLOCKAGE')) reasons.push('Road blockage mentioned in reports');
  const phrases = conditions.map(c => ({ ROAD_BLOCKAGE: c.status === 'POSSIBLE' ? 'possible road blockage' : 'road blockage reported',
    PEOPLE_TRAPPED: c.status === 'POSSIBLE' ? 'people may be trapped' : 'people reported trapped',
    INJURY: c.status === 'POSSIBLE' ? 'possible injuries' : 'injuries reported',
    FIRE: 'fire mentioned', FLOOD: 'flooding mentioned', STRUCTURAL_DAMAGE: 'structural damage mentioned' })[c.type]);
  const label = ordered[0].incidentType.toLowerCase().replace(/_/g, ' ');
  return {
    id: ordered[0].situationId || ordered[0].id, incidentType: ordered[0].incidentType,
    centerLatitude: coordinates.reduce((sum, r) => sum + r.latitude, 0) / coordinates.length,
    centerLongitude: coordinates.reduce((sum, r) => sum + r.longitude, 0) / coordinates.length,
    reportIds: ordered.map(r => r.id), reportCount: ordered.length,
    firstReportedAt: ordered[0].createdAt, lastReportedAt: ordered.at(-1).createdAt,
    updatedAt: ordered.at(-1).createdAt, severity: SEVERITIES[severityIndex], severityReasons: reasons,
    conditions, responseNeeds: [...responseNeeds],
    summary: `${ordered.length} ${ordered.length === 1 ? 'report' : 'related reports'} indicate a ${label} in this area${phrases.length ? `; ${phrases.join('; ')}` : ''}. All details are unverified public reports.`,
    confidence: Math.min(0.9, 0.45 + Math.min(ordered.length - 1, 3) * 0.13),
    confidenceLabel: ordered.length >= 3 ? 'HIGH' : ordered.length === 2 ? 'MEDIUM' : 'LOW',
    analysisMode: 'RULE_BASED', demoMode: ordered[0].demoMode === true,
    reports: ordered.map(r => ({ id: r.id, description: r.description, incidentType: r.incidentType,
      severity: r.severity, latitude: r.latitude, longitude: r.longitude, createdAt: r.createdAt })),
  };
}

function constrainSituationAI(situation, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (result.incidentType !== situation.incidentType || !SEVERITIES.includes(result.severityAssessment)) return null;
  if (!Array.isArray(result.reportIds) || !result.reportIds.length || result.reportIds.some(id => !situation.reportIds.includes(id))) return null;
  if (!Array.isArray(result.conditions) || !Array.isArray(result.responseNeeds)) return null;
  if (result.conditions.some(c => !CONDITION_TYPES.includes(c?.type) || !['REPORTED', 'POSSIBLE'].includes(c.status) ||
    !situation.conditions.some(fact => fact.type === c.type && fact.status === c.status))) return null;
  if (result.responseNeeds.some(need => !RESPONSE_NEEDS.includes(need) || !situation.responseNeeds.includes(need))) return null;
  if (typeof result.severityConfidence !== 'number' || result.severityConfidence < 0 || result.severityConfidence > 1) return null;
  // Factual summary, severity, evidence and location remain backend-derived.
  return { ...situation, analysisMode: 'AI_ASSISTED' };
}

module.exports = { CONDITION_TYPES, RESPONSE_NEEDS, evidenceFor, groupedReports, findRelatedSituation, buildSituation, constrainSituationAI };
