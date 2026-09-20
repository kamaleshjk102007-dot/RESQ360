const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { evaluateArrival } = require('./reacher-verification');
const { INCIDENT_TYPES, SEVERITIES, validCoordinates, rankResources, fallbackRecommendation, constrainAIRecommendation } = require('./resource-matching');
const { groupedReports, findRelatedSituation, buildSituation, constrainSituationAI } = require('./situation-intelligence');

const PORT = Number(process.env.PORT) || 10000;
// Render (and most PaaS providers) require binding to all interfaces, not
// just localhost/loopback or an IPv6-only unspecified address. Passing no
// host to server.listen() defers to Node's default, which resolves to '::'
// (IPv6) when available before falling back to '0.0.0.0' — in some
// container runtimes that IPv6-only bind is invisible to an external port
// scanner. Binding explicitly to '0.0.0.0' removes that ambiguity entirely.
const HOST = '0.0.0.0';

const DATA_DIR = process.env.SAFEGUARD_DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'registered-tokens.json');
const ALERTS_FILE = path.join(DATA_DIR, 'broadcast-alerts.json');
const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence-vault');
const PUBLIC_INCIDENTS_FILE = path.join(DATA_DIR, 'public-incidents.json');
const DEMO_RESOURCES_FILE = path.join(__dirname, 'demo-resources.json');
const AUTHORITY_KEY = process.env.RESQ_AUTHORITY_KEY || '';
const RESOURCE_SEARCH_RADIUS_KM = positiveConfig('RESOURCE_SEARCH_RADIUS_KM', 10);
const SITUATION_CORRELATION_RADIUS_KM = positiveConfig('SITUATION_CORRELATION_RADIUS_KM', 1);
const SITUATION_CORRELATION_WINDOW_MINUTES = positiveConfig('SITUATION_CORRELATION_WINDOW_MINUTES', 30);
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const API_KEY = process.env.SAFEGUARD_ALERT_API_KEY || '';
const MAX_SENDER_NAME_LENGTH = 40;
const DEFAULT_SENDER_NAME = 'Someone';
const ALERT_RADIUS_KM = Number(process.env.SAFEGUARD_ALERT_RADIUS_KM) || 1;
function positiveConfig(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
const ARRIVAL_RADIUS_METERS = positiveConfig('REACHER_ARRIVAL_RADIUS_METERS', 150);
const MAX_LOCATION_AGE_MS = positiveConfig('REACHER_LOCATION_MAX_AGE_SECONDS', 60) * 1000;
const MAX_GPS_ACCURACY_METERS = positiveConfig('REACHER_MAX_GPS_ACCURACY_METERS', 50);

function distanceKm(aLat, aLng, bLat, bLng) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(bLat - aLat); const dLng = rad(bLng - aLng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
}

function saveTokens(tokens) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tokens, null, 2));
}

function loadAlerts() {
  try {
    return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
}

function saveAlert(alert) {
  const alerts = [alert, ...loadAlerts()].slice(0, 100);
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

function saveAlerts(alerts) {
  // Keep active incidents even as frequent live-location events roll over.
  const active = alerts.filter(item => !item.locationUpdate && !item.evidenceUpdate && !item.safeResolved && !item.resolved);
  const retained = [...new Set([...active, ...alerts.slice(0, 100)])];
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(retained, null, 2));
}

function loadPublicIncidents() {
  try { return JSON.parse(fs.readFileSync(PUBLIC_INCIDENTS_FILE, 'utf8')); } catch (_) { return []; }
}

function savePublicIncidents(incidents) {
  fs.writeFileSync(PUBLIC_INCIDENTS_FILE, JSON.stringify(incidents.slice(0, 500), null, 2));
}

function loadDemoResources() {
  try {
    const data = JSON.parse(fs.readFileSync(DEMO_RESOURCES_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}

function authorityAllowed(req) {
  if (!AUTHORITY_KEY) return false;
  const supplied = String(req.headers['x-resq-authority-key'] || '');
  const expected = Buffer.from(AUTHORITY_KEY);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function authorityGuard(req, res) {
  if (!AUTHORITY_KEY) { json(res, 503, { error: 'Authority access is not configured' }); return false; }
  if (!authorityAllowed(req)) { json(res, 403, { error: 'Authority access required' }); return false; }
  return true;
}

async function resourceRecommendation(incident, resources) {
  const fallback = fallbackRecommendation(incident, resources);
  const endpoint = process.env.RESQ_RESOURCE_AI_URL;
  if (!endpoint || !process.env.RESQ_RESOURCE_AI_API_KEY || !resources.length) return fallback;
  try {
    if (!new URL(endpoint).protocol.startsWith('https:')) return fallback;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(endpoint, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESQ_RESOURCE_AI_API_KEY}` },
        body: JSON.stringify({ incident: { incidentType: incident.incidentType, severity: incident.severity, description: incident.description },
          resources: resources.map(({ id, name, type, distanceKm, matchingCapabilities, status }) => ({ id, name, type, distanceKm, matchingCapabilities, status })) }) });
      if (!response.ok) return fallback;
      const result = await response.json();
      return constrainAIRecommendation(resources, result) || fallback;
    } finally { clearTimeout(timeout); }
  } catch (_) { return fallback; }
}

function situationForIncident(incident, incidents) {
  const id = incident.situationId || incident.id;
  return buildSituation(groupedReports(incidents).get(id) || [incident]);
}

async function situationAssessment(situation) {
  const endpoint = process.env.SITUATION_AI_URL;
  if (!endpoint || !process.env.SITUATION_AI_API_KEY) return situation;
  try {
    if (new URL(endpoint).protocol !== 'https:') return situation;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), positiveConfig('SITUATION_AI_TIMEOUT_MS', 3000));
    try {
      const response = await fetch(endpoint, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SITUATION_AI_API_KEY}` },
        body: JSON.stringify({ situationId: situation.id, incidentType: situation.incidentType,
          reports: situation.reports, factualConditions: situation.conditions,
          ruleBasedSeverity: situation.severity, permittedResponseNeeds: situation.responseNeeds }) });
      if (!response.ok) return situation;
      return constrainSituationAI(situation, await response.json()) || situation;
    } finally { clearTimeout(timeout); }
  } catch (_) { return situation; }
}

function evidenceOwnerId(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function ensureEvidenceDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function ownerEvidenceFiles(token) {
  ensureEvidenceDir();
  const prefix = `${evidenceOwnerId(token)}-`;
  return fs.readdirSync(EVIDENCE_DIR).filter(name => name.startsWith(prefix) && name.endsWith('.json'));
}

async function readJson(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function isAuthorized(req) {
  if (!API_KEY) return true;
  const auth = req.headers.authorization || '';
  const token = req.headers['x-safeguard-api-key'] || '';
  return auth === `Bearer ${API_KEY}` || token === API_KEY;
}

function validateExpoToken(token) {
  return typeof token === 'string' && /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/.test(token);
}

function validateCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function validAccuracy(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function registeredResponder(token, senderToken) {
  return validateExpoToken(token) && token !== senderToken && loadTokens().some(entry => entry.token === token);
}

function freshObservedAt(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.now() + 30000 && Date.now() - time <= MAX_LOCATION_AGE_MS;
}

// Trims whitespace, caps length, and falls back to a default when empty.
function normalizeSenderName(rawName) {
  const trimmed = String(rawName || '').trim().slice(0, MAX_SENDER_NAME_LENGTH);
  return trimmed || DEFAULT_SENDER_NAME;
}

function pushCopy(language, name) {
  if (language === 'hi') return { title: `🚨 ${name} को मदद चाहिए!`, body: 'लाइव स्थान देखने के लिए टैप करें।' };
  if (language === 'ta') return { title: `🚨 ${name}க்கு உதவி தேவை!`, body: 'நேரடி இருப்பிடத்தை பார்க்க தட்டவும்.' };
  return { title: `🚨 ${name} needs help!`, body: 'Tap to view their live location.' };
}

function clientError(res, error) {
  return json(res, error.statusCode || 400, { error: error.message || 'Bad request' });
}

async function sendExpoPushNotifications(messages) {
  if (process.env.NODE_ENV === 'test') return { sent: messages.length, simulated: true };
  if (!messages.length) {
    return { sent: 0 };
  }

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(`Expo push send failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { ok: true, service: 'RESQ 360 broadcast server' });
    }

    if (req.method === 'POST' && req.url === '/public-incidents') {
      try {
        const body = await readJson(req);
        const incidentType = String(body.incidentType || '').toUpperCase();
        const severity = String(body.severity || '').toUpperCase();
        if (!INCIDENT_TYPES.includes(incidentType) || !SEVERITIES.includes(severity)) return json(res, 400, { error: 'Valid incident type and severity are required' });
        const latitude = Number(body.latitude), longitude = Number(body.longitude);
        if (body.latitude == null || body.longitude == null || !validCoordinates(latitude, longitude)) return json(res, 400, { error: 'Valid incident coordinates are required' });
        const incident = { id: crypto.randomUUID(), incidentType, severity, latitude, longitude,
          description: String(body.description || '').trim().slice(0, 500), createdAt: new Date().toISOString(),
          demoMode: body.demoMode === true, status: 'REPORTED', coordinationActions: [] };
        const incidents = loadPublicIncidents();
        const duplicate = incidents.find(item => item.incidentType === incidentType && item.demoMode === incident.demoMode &&
          item.description === incident.description && Math.abs(Date.parse(item.createdAt) - Date.parse(incident.createdAt)) < 10000 &&
          validCoordinates(item.latitude, item.longitude) && distanceKm(latitude, longitude, item.latitude, item.longitude) < 0.02);
        if (duplicate) return json(res, 200, { ok: true, duplicate: true, incidentId: duplicate.id, situationId: duplicate.situationId || duplicate.id, status: duplicate.status });
        incident.situationId = findRelatedSituation(incident, incidents, SITUATION_CORRELATION_RADIUS_KM,
          SITUATION_CORRELATION_WINDOW_MINUTES) || `SI-${crypto.randomUUID()}`;
        savePublicIncidents([incident, ...incidents]);
        return json(res, 201, { ok: true, incidentId: incident.id, situationId: incident.situationId, status: incident.status, message: 'Public incident recorded for authority review; no agency was dispatched.' });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'GET' && req.url === '/public-incidents') {
      if (!authorityGuard(req, res)) return;
      return json(res, 200, { ok: true, incidents: loadPublicIncidents() });
    }

    if (req.method === 'GET' && req.url === '/public-situations') {
      if (!authorityGuard(req, res)) return;
      const situations = [...groupedReports(loadPublicIncidents()).values()].map(buildSituation)
        .filter(Boolean).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      return json(res, 200, { ok: true, situations });
    }

    const situationMatch = req.url?.match(/^\/public-situations\/([A-Za-z0-9-]+)$/);
    if (req.method === 'GET' && situationMatch) {
      if (!authorityGuard(req, res)) return;
      const reports = groupedReports(loadPublicIncidents()).get(situationMatch[1]);
      if (!reports) return json(res, 404, { error: 'Situation not found' });
      return json(res, 200, { ok: true, situation: await situationAssessment(buildSituation(reports)) });
    }

    const incidentSituationMatch = req.url?.match(/^\/public-incidents\/([A-Za-z0-9-]+)\/situation$/);
    if (req.method === 'GET' && incidentSituationMatch) {
      if (!authorityGuard(req, res)) return;
      const incidents = loadPublicIncidents();
      const incident = incidents.find(item => item.id === incidentSituationMatch[1]);
      if (!incident) return json(res, 404, { error: 'Public incident not found' });
      return json(res, 200, { ok: true, situation: await situationAssessment(situationForIncident(incident, incidents)) });
    }

    const resourceMatch = req.url?.match(/^\/public-incidents\/([A-Za-z0-9-]+)\/nearby-resources$/);
    if (req.method === 'GET' && resourceMatch) {
      if (!authorityGuard(req, res)) return;
      const incidents = loadPublicIncidents();
      const incident = incidents.find(item => item.id === resourceMatch[1]);
      if (!incident) return json(res, 404, { error: 'Public incident not found' });
      if (!validCoordinates(incident.latitude, incident.longitude)) return json(res, 422, { error: 'Incident location is missing or invalid' });
      const situation = await situationAssessment(situationForIncident(incident, incidents));
      const picture = { ...incident, latitude: situation.centerLatitude, longitude: situation.centerLongitude,
        severity: situation.severity, responseNeeds: situation.responseNeeds, description: situation.summary };
      const resources = rankResources(picture, loadDemoResources(), RESOURCE_SEARCH_RADIUS_KM);
      const recommendation = await resourceRecommendation(picture, resources);
      return json(res, 200, { ok: true, incident, situation, radiusKm: RESOURCE_SEARCH_RADIUS_KM, resources, recommendation,
        dataSource: 'REGISTERED_DEMO_DATA', officialAvailability: false,
        message: resources.length ? 'Authority decision support only; no agency has been dispatched.' : `No relevant registered demo resources found within ${RESOURCE_SEARCH_RADIUS_KM} km.` });
    }

    const coordinateMatch = req.url?.match(/^\/public-incidents\/([A-Za-z0-9-]+)\/coordinate$/);
    if (req.method === 'POST' && coordinateMatch) {
      if (!authorityGuard(req, res)) return;
      try {
        const body = await readJson(req);
        const incidents = loadPublicIncidents();
        const index = incidents.findIndex(item => item.id === coordinateMatch[1]);
        if (index < 0) return json(res, 404, { error: 'Public incident not found' });
        const incident = incidents[index];
        if (incident.status === 'CLOSED') return json(res, 409, { error: 'Incident is closed' });
        const situation = situationForIncident(incident, incidents);
        const candidates = rankResources({ ...incident, latitude: situation.centerLatitude, longitude: situation.centerLongitude,
          severity: situation.severity, responseNeeds: situation.responseNeeds }, loadDemoResources(), RESOURCE_SEARCH_RADIUS_KM);
        const selected = candidates.find(item => item.id === body.resourceId && item.available);
        if (!selected) return json(res, 422, { error: 'Select an available, relevant registered demo resource within the search radius' });
        const action = { id: crypto.randomUUID(), resourceId: selected.id, resourceName: selected.name,
          at: new Date().toISOString(), status: 'COORDINATION_INITIATED', demo: true };
        incident.coordinationActions = [...(incident.coordinationActions || []), action];
        incident.status = 'COORDINATION_INITIATED';
        savePublicIncidents(incidents);
        return json(res, 200, { ok: true, action, message: 'Response coordination initiated. No agency was automatically dispatched.' });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'GET' && req.url.startsWith('/evidence/audio')) {
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const evidenceId = String(url.searchParams.get('id') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
        const accessKey = String(url.searchParams.get('key') || '');
        if (!evidenceId || accessKey.length < 32) return json(res, 400, { error: 'Invalid evidence link' });
        ensureEvidenceDir();
        const fileName = fs.readdirSync(EVIDENCE_DIR).find(name => name.endsWith(`-${evidenceId}.json`));
        if (!fileName) return json(res, 404, { error: 'Evidence not found' });
        const record = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, fileName), 'utf8'));
        if (record.accessKey !== accessKey || !record.audioBase64) return json(res, 403, { error: 'Evidence access denied' });
        const audio = Buffer.from(record.audioBase64, 'base64');
        res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Content-Length': audio.length, 'Cache-Control': 'private, no-store' });
        return res.end(audio);
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'GET' && req.url.startsWith('/alerts')) {
      try {
        if (!isAuthorized(req)) {
          return json(res, 401, { error: 'Unauthorized' });
        }

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const since = url.searchParams.get('since') || '';
        const alerts = loadAlerts();
        const filtered = since ? alerts.filter((alert) => String(alert.id) > since) : alerts.slice(0, 10);
        return json(res, 200, { ok: true, alerts: filtered.slice(0, 20) });
      } catch (error) {
        return clientError(res, error);
      }
    }

    if (req.method === 'POST' && req.url === '/register-token') {
      try {
        if (!isAuthorized(req)) {
          return json(res, 401, { error: 'Unauthorized' });
        }
        const body = await readJson(req);
        if (!validateExpoToken(body.token)) {
          return json(res, 400, { error: 'valid Expo push token is required' });
        }

        const installationId = String(body.installationId || '').slice(0, 120);
        const previousToken = String(body.previousToken || '');
        const tokens = loadTokens().filter((entry) =>
          entry.token !== body.token &&
          (!previousToken || entry.token !== previousToken) &&
          (!installationId || entry.installationId !== installationId)
        );
        tokens.push({
          token: body.token,
          installationId,
          label: String(body.label || 'RESQ 360 User').slice(0, 80),
          platform: body.platform || 'unknown',
          updatedAt: new Date().toISOString(),
          lat: validateCoordinate(body.lat, -90, 90) ? Number(body.lat) : null,
          lng: validateCoordinate(body.lng, -180, 180) ? Number(body.lng) : null,
        });
        saveTokens(tokens);
        return json(res, 200, { ok: true, registered: body.token, total: tokens.length });
      } catch (error) {
        return clientError(res, error);
      }
    }

    if (req.method === 'POST' && req.url === '/evidence/upload') {
      try {
        if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readJson(req);
        if (!validateExpoToken(body.ownerToken)) return json(res, 400, { error: 'valid owner token is required' });
        const evidenceId = String(body.evidenceId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
        if (!evidenceId) return json(res, 400, { error: 'evidenceId is required' });
        const audioBase64 = String(body.audioBase64 || '');
        if (audioBase64 && !/^[A-Za-z0-9+/=]+$/.test(audioBase64)) return json(res, 400, { error: 'invalid audio data' });
        ensureEvidenceDir();
        const ownerId = evidenceOwnerId(body.ownerToken);
        const accessKey = crypto.randomBytes(24).toString('hex');
        const record = { id: evidenceId, ownerId, accessKey, startedAt: body.startedAt || null, endedAt: body.endedAt || null,
          locations: Array.isArray(body.locations) ? body.locations.slice(-100) : [], audioBase64,
          uploadedAt: new Date().toISOString(), retainedAfterDuress: false };
        fs.writeFileSync(path.join(EVIDENCE_DIR, `${ownerId}-${evidenceId}.json`), JSON.stringify(record));
        const files = ownerEvidenceFiles(body.ownerToken).map(name => ({ name, time: fs.statSync(path.join(EVIDENCE_DIR, name)).mtimeMs })).sort((a, b) => b.time - a.time);
        files.slice(360).forEach(item => fs.unlinkSync(path.join(EVIDENCE_DIR, item.name)));
        const accessPath = `/evidence/audio?id=${encodeURIComponent(evidenceId)}&key=${encodeURIComponent(accessKey)}`;
        if (body.alertId) {
          const alerts = loadAlerts();
          const alertIndex = alerts.findIndex(item => item.id === body.alertId);
          if (alertIndex >= 0 && alerts[alertIndex].senderToken === body.ownerToken) {
            const evidenceLinks = Array.isArray(alerts[alertIndex].evidenceLinks) ? alerts[alertIndex].evidenceLinks : [];
            const evidenceLink = { id: evidenceId, path: accessPath, createdAt: record.uploadedAt };
            alerts[alertIndex].evidenceLinks = [...evidenceLinks.filter(item => item.id !== evidenceId), evidenceLink].slice(-360);
            const recipientTokens = loadTokens().filter(entry => (alerts[alertIndex].notifiedTokens || []).includes(entry.token));
            await sendExpoPushNotifications(recipientTokens.map(entry => ({
              to: entry.token, sound: 'default', title: 'New SOS evidence available',
              body: 'A new 10-second emergency audio part is available.',
              data: { remoteBroadcast: true, evidenceUpdate: true, alertId: body.alertId, evidenceLinks: alerts[alertIndex].evidenceLinks },
              priority: 'high', ttl: 3600, tag: `sos-evidence-${body.alertId}`, channelId: 'resq-community-emergency-v2',
            }))).catch(() => null);
            const evidenceEvent = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, evidenceUpdate: true,
              targetAlertId: body.alertId, evidenceLinks: alerts[alertIndex].evidenceLinks };
            saveAlerts([evidenceEvent, ...alerts]);
          }
        }
        return json(res, 200, { ok: true, evidenceId, uploadedAt: record.uploadedAt,
          accessPath });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'POST' && req.url === '/evidence/delete') {
      try {
        if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readJson(req);
        if (!validateExpoToken(body.ownerToken)) return json(res, 400, { error: 'valid owner token is required' });
        const files = ownerEvidenceFiles(body.ownerToken);
        if (body.duress === true) {
          files.forEach(name => {
            const file = path.join(EVIDENCE_DIR, name);
            const record = JSON.parse(fs.readFileSync(file, 'utf8'));
            fs.writeFileSync(file, JSON.stringify({ ...record, retainedAfterDuress: true, duressAt: new Date().toISOString() }));
          });
          return json(res, 200, { ok: true, hiddenLocally: true, retained: files.length });
        }
        files.forEach(name => fs.unlinkSync(path.join(EVIDENCE_DIR, name)));
        return json(res, 200, { ok: true, deleted: files.length });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'POST' && req.url === '/broadcast-sos') {
      try {
        if (!isAuthorized(req)) {
          return json(res, 401, { error: 'Unauthorized' });
        }
        const body = await readJson(req);
        if (!validateCoordinate(body.lat, -90, 90) || !validateCoordinate(body.lng, -180, 180)) {
          return json(res, 400, { error: 'valid lat and lng are required' });
        }

        const tokens = loadTokens();
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        const source = String(body.source || 'APP_USER').slice(0, 40);
        const timestamp = body.timestamp || new Date().toISOString();
        const senderToken = body.senderToken || '';
        if (!validateExpoToken(senderToken)) return json(res, 400, { error: 'registered sender token is required' });
        const senderInstallationId = String(body.senderInstallationId || '').slice(0, 120);
        const senderName = normalizeSenderName(body.senderName);
        const language = ['en', 'hi', 'ta'].includes(body.language) ? body.language : 'en';
        const alert = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          lat,
          lng,
          source,
          timestamp,
          senderToken,
          senderInstallationId,
          senderName,
          language,
          accuracy: validAccuracy(body.accuracy) ? Number(body.accuracy) : null,
          locationUpdatedAt: freshObservedAt(body.locationTimestamp) ? new Date().toISOString() : null,
        };
        saveAlert(alert);

        // FIX: exclude the sender's own token from the push fan-out so the
        // person who triggered the SOS doesn't get notified about their own alert.
        const otherTokens = tokens.filter((entry) =>
          entry.token !== senderToken &&
          (!senderInstallationId || entry.installationId !== senderInstallationId)
        );
        const nearbyTokens = otherTokens.filter(entry =>
          entry.lat !== null && entry.lng !== null && distanceKm(lat, lng, entry.lat, entry.lng) <= ALERT_RADIUS_KM
        );
        const recipientTokens = nearbyTokens;
        alert.notifiedTokens = recipientTokens.map(entry => entry.token);
        alert.delivery = { targeted: recipientTokens.length, radiusKm: ALERT_RADIUS_KM, mode: 'nearby' };
        saveAlerts([alert, ...loadAlerts().filter(item => item.id !== alert.id)]);

        const initialCopy = pushCopy(language, senderName);
        const messages = recipientTokens.map((entry) => ({
          to: entry.token,
          sound: 'default',
          title: `🚨 ${senderName} needs help!`,
          body: 'Tap to view their location.',
          data: {
            lat,
            lng,
            source,
            timestamp,
            remoteBroadcast: true,
            alertId: alert.id,
            senderToken: alert.senderToken,
            senderName: alert.senderName,
          },
          priority: 'high',
          ttl: 3600,
          tag: `sos-${alert.id}`,
          channelId: 'resq-community-emergency-v2',
        }));

        const result = await sendExpoPushNotifications(messages.map(message => ({ ...message, title: initialCopy.title, body: initialCopy.body })));
        return json(res, 200, { ok: true, recipients: recipientTokens.length, alert, result });
      } catch (error) {
        return clientError(res, error);
      }
    }

    if (req.method === 'POST' && req.url === '/escalate-sos') {
      try {
        if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readJson(req); const alerts = loadAlerts();
        const index = alerts.findIndex(alert => alert.id === body.alertId);
        if (index < 0) return json(res, 404, { error: 'Alert not found' });
        const alert = alerts[index];
        if (alert.senderToken !== body.senderToken) return json(res, 403, { error: 'Sender mismatch' });
        const radiusKm = Math.min(10, Math.max(1, Number(body.radiusKm) || 1));
        const notified = new Set(alert.notifiedTokens || []);
        const expandedCopy = pushCopy(alert.language, alert.senderName);
        const recipients = loadTokens().filter(entry => {
          if (entry.token === alert.senderToken ||
              (alert.senderInstallationId && entry.installationId === alert.senderInstallationId) ||
              notified.has(entry.token)) return false;
          if (entry.lat === null || entry.lng === null) return radiusKm >= 10;
          return distanceKm(alert.lat, alert.lng, entry.lat, entry.lng) <= radiusKm;
        });
        const messages = recipients.map(entry => ({
          to: entry.token, sound: 'default', title: `🚨 ${alert.senderName} needs help!`,
          body: 'Tap to view their live location.',
          data: { lat: alert.lat, lng: alert.lng, source: alert.source, timestamp: alert.timestamp, remoteBroadcast: true, alertId: alert.id, senderToken: alert.senderToken, senderName: alert.senderName },
          priority: 'high', ttl: 3600, tag: `sos-${alert.id}`, channelId: 'resq-community-emergency-v2',
        }));
        const result = await sendExpoPushNotifications(messages.map(message => ({ ...message, title: expandedCopy.title, body: expandedCopy.body })));
        alerts[index].notifiedTokens = [...notified, ...recipients.map(entry => entry.token)];
        alerts[index].delivery = { targeted: alerts[index].notifiedTokens.length, radiusKm, mode: radiusKm >= 10 ? 'maximum' : 'expanded' };
        saveAlerts(alerts);
        return json(res, 200, { ok: true, recipients: recipients.length, totalRecipients: alerts[index].notifiedTokens.length, radiusKm, result });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'POST' && req.url === '/acknowledge-sos') {
      try {
        if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readJson(req); const alerts = loadAlerts();
        const index = alerts.findIndex(alert => alert.id === body.alertId);
        if (index < 0) return json(res, 404, { error: 'Alert not found' });
        if (alerts[index].resolved) return json(res, 409, { error: 'This SOS has already ended' });
        if (!registeredResponder(body.responderToken, alerts[index].senderToken)) return json(res, 403, { error: 'Registered responder required' });
        const acknowledgement = { token: String(body.responderToken || ''), name: normalizeSenderName(body.responderName), at: new Date().toISOString() };
        const current = Array.isArray(alerts[index].acknowledgements) ? alerts[index].acknowledgements : [];
        alerts[index].acknowledgements = [...current.filter(item => item.token !== acknowledgement.token), acknowledgement];
        saveAlerts(alerts);
        return json(res, 200, { ok: true, acknowledgements: alerts[index].acknowledgements });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'POST' && req.url === '/update-responder-location') {
      try {
        if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readJson(req); const alerts = loadAlerts();
        const index = alerts.findIndex(alert => alert.id === body.alertId && !alert.locationUpdate);
        if (index < 0) return json(res, 404, { error: 'Alert not found' });
        const alert = alerts[index];
        if (alert.resolved) return json(res, 409, { error: 'This SOS has already ended' });
        if (!registeredResponder(body.responderToken, alert.senderToken) || !(alert.acknowledgements || []).some(item => item.token === body.responderToken)) return json(res, 403, { error: 'Responder is not participating in this SOS' });
        if (!validateCoordinate(body.lat, -90, 90) || !validateCoordinate(body.lng, -180, 180) || !validAccuracy(body.accuracy) || !freshObservedAt(body.locationTimestamp)) return json(res, 400, { error: 'Current GPS location, accuracy and timestamp are required' });
        const responderLocations = alert.responderLocations || {};
        responderLocations[body.responderToken] = { lat: Number(body.lat), lng: Number(body.lng), accuracy: Number(body.accuracy), timestamp: new Date().toISOString(), observedAt: body.locationTimestamp };
        alert.responderLocations = responderLocations;
        saveAlerts(alerts);
        return json(res, 200, { ok: true, locationUpdatedAt: responderLocations[body.responderToken].timestamp });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'POST' && req.url === '/verify-arrival') {
      try {
        if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readJson(req); const alerts = loadAlerts();
        const index = alerts.findIndex(alert => alert.id === body.alertId && !alert.locationUpdate);
        if (index < 0) return json(res, 404, { error: 'Alert not found' });
        if (alerts[index].resolved) return json(res, 409, { error: 'This SOS has already ended' });
        const alert = alerts[index];
        if (!registeredResponder(body.responderToken, alert.senderToken) || !(alert.acknowledgements || []).some(item => item.token === body.responderToken)) return json(res, 403, { error: 'Responder is not participating in this SOS' });
        const previous = (alert.verifiedArrivals || []).find(item => item.token === body.responderToken);
        if (previous) return json(res, 200, { ok: true, verified: true, arrival: previous, thresholdMeters: ARRIVAL_RADIUS_METERS });
        const sender = { lat: alert.lat, lng: alert.lng, accuracy: alert.accuracy, timestamp: alert.locationUpdatedAt };
        const reacher = (alert.responderLocations || {})[body.responderToken];
        const result = evaluateArrival(sender, reacher, Date.now(), { radiusMeters: ARRIVAL_RADIUS_METERS, maxAgeMs: MAX_LOCATION_AGE_MS, maxAccuracyMeters: MAX_GPS_ACCURACY_METERS });
        const arrival = { token: body.responderToken, name: normalizeSenderName(body.responderName), at: result.verified ? new Date().toISOString() : null,
          status: result.verified ? 'VERIFIED' : 'NOT_VERIFIED', distanceMeters: result.distanceMeters, thresholdMeters: ARRIVAL_RADIUS_METERS,
          reason: result.reason, senderLocation: sender, reacherLocation: reacher || null, verificationTimestamp: new Date().toISOString() };
        alert.arrivalAttempts = [...(alert.arrivalAttempts || []).filter(item => item.token !== body.responderToken), arrival];
        const arrivals = Array.isArray(alerts[index].verifiedArrivals) ? alerts[index].verifiedArrivals : [];
        if (result.verified) alerts[index].verifiedArrivals = [...arrivals.filter(item => item.token !== arrival.token), arrival];
        saveAlerts(alerts);
        return json(res, 200, { ok: true, ...result, arrival });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'POST' && req.url === '/request-more-help') {
      try {
        if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readJson(req); const alerts = loadAlerts();
        const index = alerts.findIndex(alert => alert.id === body.alertId && !alert.locationUpdate);
        if (index < 0) return json(res, 404, { error: 'Alert not found' });
        if (alerts[index].resolved) return json(res, 409, { error: 'This SOS has already ended' });
        if (!registeredResponder(body.responderToken, alerts[index].senderToken) || !(alerts[index].acknowledgements || []).some(item => item.token === body.responderToken)) return json(res, 403, { error: 'Responder is not participating in this SOS' });
        const arrival = (alerts[index].verifiedArrivals || []).find(item => item.token === body.responderToken);
        if (!arrival) return json(res, 403, { error: 'Verified arrival is required before requesting more help' });

        alerts[index].moreHelpRequests = [
          ...(alerts[index].moreHelpRequests || []),
          { token: body.responderToken, name: arrival.name, at: new Date().toISOString() },
        ].slice(-20);
        saveAlerts(alerts);
        const recipients = loadTokens().filter(entry =>
          entry.token !== body.responderToken &&
          entry.token !== alerts[index].senderToken &&
          (!alerts[index].senderInstallationId || entry.installationId !== alerts[index].senderInstallationId)
        );
        const messages = recipients.map(entry => ({
          to: entry.token,
          sound: 'default',
          title: `🆘 ${arrival.name} needs more help`,
          body: `A verified responder reached ${alerts[index].senderName}. Additional support is needed.`,
          data: { lat: alerts[index].lat, lng: alerts[index].lng, source: 'VERIFIED RESPONDER', timestamp: new Date().toISOString(), remoteBroadcast: true, alertId: alerts[index].id, senderToken: alerts[index].senderToken, senderName: alerts[index].senderName, moreHelpRequested: true },
          priority: 'high', ttl: 3600, tag: `more-help-${alerts[index].id}`, channelId: 'resq-community-emergency-v2',
        }));
        const result = await sendExpoPushNotifications(messages);
        return json(res, 200, { ok: true, recipients: recipients.length, result });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'POST' && req.url === '/update-sos-location') {
      try {
        if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readJson(req); const alerts = loadAlerts();
        const index = alerts.findIndex(alert => alert.id === body.alertId);
        if (index < 0) return json(res, 404, { error: 'Alert not found' });
        if (alerts[index].senderToken !== body.senderToken) return json(res, 403, { error: 'Sender mismatch' });
        if (alerts[index].resolved) return json(res, 409, { error: 'This SOS has already ended' });
        if (!validateCoordinate(body.lat, -90, 90) || !validateCoordinate(body.lng, -180, 180)) return json(res, 400, { error: 'Invalid location' });
        if (!validAccuracy(body.accuracy) || !freshObservedAt(body.locationTimestamp)) return json(res, 400, { error: 'Current GPS accuracy and timestamp are required' });
        alerts[index] = { ...alerts[index], lat: Number(body.lat), lng: Number(body.lng), accuracy: Number(body.accuracy), locationUpdatedAt: new Date().toISOString() };
        const locationEvent = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, locationUpdate: true, targetAlertId: body.alertId, lat: alerts[index].lat, lng: alerts[index].lng, accuracy: alerts[index].accuracy, locationUpdatedAt: alerts[index].locationUpdatedAt };
        saveAlerts([locationEvent, ...alerts]); return json(res, 200, { ok: true, alert: alerts[index] });
      } catch (error) { return clientError(res, error); }
    }

    if (req.method === 'GET' && req.url.startsWith('/alert-status')) {
      if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const alert = loadAlerts().find(item => item.id === url.searchParams.get('id'));
      if (!alert) return json(res, 404, { error: 'Alert not found' });
      return json(res, 200, { ok: true, alert });
    }

    if (req.method === 'POST' && req.url === '/resolve-sos') {
      try {
        if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
        const body = await readJson(req);
        const alerts = loadAlerts();
        const index = alerts.findIndex((alert) => alert.id === body.alertId);
        if (index < 0) return json(res, 404, { error: 'Alert not found' });
        if (!body.senderToken || alerts[index].senderToken !== body.senderToken) {
          return json(res, 403, { error: 'Only the alert sender can mark it safe' });
        }

        const resolvedAt = new Date().toISOString();
        alerts[index] = { ...alerts[index], resolved: true, resolvedAt };
        const resolutionEvent = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          safeResolved: true,
          targetAlertId: body.alertId,
          resolvedAt,
          senderName: alerts[index].senderName,
        };
        saveAlerts([resolutionEvent, ...alerts]);
        const recipientTokens = loadTokens().filter((entry) =>
          entry.token !== body.senderToken &&
          (!alerts[index].senderInstallationId || entry.installationId !== alerts[index].senderInstallationId)
        );
        const messages = recipientTokens.map((entry) => ({
          to: entry.token,
          sound: 'default',
          title: `✅ ${alerts[index].senderName} is safe`,
          body: 'The SOS alert has ended automatically.',
          data: { remoteBroadcast: true, safeResolved: true, alertId: body.alertId, resolvedAt },
          priority: 'high',
          ttl: 3600,
          tag: `sos-resolved-${body.alertId}`,
          channelId: 'resq-community-emergency-v2',
        }));
        const result = await sendExpoPushNotifications(messages);
        return json(res, 200, { ok: true, alert: alerts[index], result });
      } catch (error) {
        return clientError(res, error);
      }
    }

    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    // Defensive top-level catch: any unexpected synchronous throw or
    // unhandled rejection inside the handler above previously had no
    // fallback, which risks an unhandled promise rejection crashing the
    // whole process (Node's default for async handlers). That would kill
    // the listening socket intermittently after boot, which can *also*
    // masquerade as "no open ports" on Render if it happens during the
    // health-check window.
    console.error('[RESQ 360] Unhandled request error:', error);
    if (!res.headersSent) {
      json(res, 500, { error: 'Internal server error' });
    }
  }
});

// Surface bind failures (e.g. port already in use, permission denied)
// explicitly in the logs instead of failing silently — this makes any
// future startup problem immediately diagnosable from Render's log tab.
server.on('error', (error) => {
  console.error('[RESQ 360] Server failed to start:', error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`RESQ 360 broadcast server listening on http://${HOST}:${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
