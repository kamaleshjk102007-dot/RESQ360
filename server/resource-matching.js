const { calculateDistanceMeters } = require('./reacher-verification');

const INCIDENT_TYPES = ['FIRE', 'ACCIDENT', 'FLOOD', 'LANDSLIDE', 'MEDICAL', 'BUILDING_COLLAPSE', 'MISSING_PERSON', 'OTHER'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const REQUIREMENTS = {
  FIRE: ['FIRE', 'RESCUE', 'MEDICAL', 'SECURITY'],
  ACCIDENT: ['MEDICAL', 'RESCUE', 'TRAFFIC', 'SECURITY'],
  FLOOD: ['FLOOD', 'WATER_RESCUE', 'RESCUE', 'MEDICAL', 'SECURITY'],
  LANDSLIDE: ['LANDSLIDE', 'DEBRIS_REMOVAL', 'RESCUE', 'MEDICAL', 'SECURITY'],
  MEDICAL: ['MEDICAL', 'AMBULANCE', 'RESCUE'],
  BUILDING_COLLAPSE: ['STRUCTURAL_RESCUE', 'RESCUE', 'MEDICAL', 'DEBRIS_REMOVAL'],
  MISSING_PERSON: ['SEARCH', 'SEARCH_AND_RESCUE', 'SECURITY', 'MEDICAL'],
  OTHER: [],
};
const NEED_CAPABILITIES = {
  FIRE_RESCUE: ['FIRE', 'RESCUE', 'LANDSLIDE'], SEARCH_AND_RESCUE: ['SEARCH_AND_RESCUE', 'SEARCH', 'RESCUE'],
  MEDICAL: ['MEDICAL', 'AMBULANCE'], ROAD_CLEARANCE: ['DEBRIS_REMOVAL', 'TRAFFIC'],
  POLICE_SUPPORT: ['SECURITY', 'TRAFFIC'], WATER_RESCUE: ['WATER_RESCUE', 'FLOOD'],
};

function validCoordinates(lat, lng) {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function rankResources(incident, resources, radiusKm) {
  if (!validCoordinates(incident?.latitude, incident?.longitude)) throw new Error('INCIDENT_LOCATION_MISSING');
  if (!INCIDENT_TYPES.includes(incident.incidentType)) throw new Error('INVALID_INCIDENT_TYPE');
  const seen = new Set();
  return (Array.isArray(resources) ? resources : []).flatMap(resource => {
    if (!resource || typeof resource.id !== 'string' || seen.has(resource.id) ||
        !validCoordinates(resource.latitude, resource.longitude) || !Array.isArray(resource.capabilities)) return [];
    seen.add(resource.id);
    const distanceKm = calculateDistanceMeters(incident.latitude, incident.longitude, resource.latitude, resource.longitude) / 1000;
    if (distanceKm > radiusKm) return [];
    const needs = Array.isArray(incident.responseNeeds) ? incident.responseNeeds : [];
    const neededCapabilities = needs.flatMap(need => NEED_CAPABILITIES[need] || []);
    const matchingCapabilities = resource.capabilities.filter(capability =>
      REQUIREMENTS[incident.incidentType].includes(capability) || neededCapabilities.includes(capability));
    if (!matchingCapabilities.length) return [];
    const status = ['AVAILABLE', 'BUSY', 'OFFLINE', 'UNKNOWN'].includes(resource.status) ? resource.status : 'UNKNOWN';
    const available = resource.available === true && status === 'AVAILABLE';
    const matchedNeeds = needs.filter(need => resource.capabilities.some(capability => NEED_CAPABILITIES[need]?.includes(capability)));
    const priority = matchedNeeds.length * 150 + matchingCapabilities.length * 100 + (available ? 50 : status === 'BUSY' ? 10 : 0) - distanceKm;
    return [{ id: resource.id, name: resource.name, type: resource.type, latitude: resource.latitude,
      longitude: resource.longitude, capabilities: resource.capabilities, matchingCapabilities,
      capabilityMatch: true, matchedNeeds, available, status,
      distanceKm: Math.round(distanceKm * 10) / 10, priority: Math.round(priority * 10) / 10, demo: true }];
  }).sort((a, b) => b.priority - a.priority || a.distanceKm - b.distanceKm || a.id.localeCompare(b.id));
}

function fallbackRecommendation(incident, resources) {
  const selected = resources.filter(item => item.available).slice(0, 2);
  return { source: 'RULE_BASED', recommendedResourceIds: selected.map(item => item.id),
    reason: selected.length ? `${selected.map(item => item.name).join(' and ')} match ${incident.incidentType.toLowerCase().replace(/_/g, ' ')} needs and are marked available in the demo registry. Authority confirmation is required.`
      : 'No relevant registered demo resources are currently marked available. Authority review is required.' };
}

function constrainAIRecommendation(resources, result) {
  const ids = Array.isArray(result?.recommendedResourceIds) ? result.recommendedResourceIds : [];
  const available = new Map(resources.filter(item => item.available).map(item => [item.id, item]));
  if (!ids.length || ids.some(id => !available.has(id))) return null;
  const selected = [...new Set(ids)].slice(0, 3).map(id => available.get(id));
  return { source: 'AI_ASSISTED', recommendedResourceIds: selected.map(item => item.id),
    reason: selected.map(item => `${item.name} (${item.distanceKm} km; ${item.matchingCapabilities.join(', ')}; ${item.status})`).join(' and ') + '. Authority confirmation is required.' };
}

module.exports = { INCIDENT_TYPES, SEVERITIES, validCoordinates, rankResources, fallbackRecommendation, constrainAIRecommendation };
