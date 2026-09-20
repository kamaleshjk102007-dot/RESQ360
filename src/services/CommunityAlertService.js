import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REQUEST_TIMEOUT_MS = 10000;
const FALLBACK_EAS_PROJECT_ID = 'b0ddfa23-d2bc-4882-8704-3b47ffa69bfc';
const ALERT_API_KEY = '';
const COMMUNITY_CHANNEL_ID = 'resq-community-emergency-v2';

function firstNonEmpty(...values) {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim() || null;
}

function resolveProjectId() {
  const runtimeProjectId = firstNonEmpty(
    Constants?.expoConfig?.extra?.eas?.projectId,
    Constants?.easConfig?.projectId,
    Constants?.manifest2?.extra?.expoClient?.extra?.eas?.projectId,
    Constants?.manifest2?.extra?.eas?.projectId,
    Constants?.manifest?.extra?.eas?.projectId,
  );

  if (runtimeProjectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runtimeProjectId)) {
    return runtimeProjectId;
  }

  return FALLBACK_EAS_PROJECT_ID;
}

function normalizeUrl(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

async function postJson(url, payload, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ALERT_API_KEY ? { 'X-SafeGuard-API-Key': ALERT_API_KEY } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function authorityGet(url, authorityKey) {
  const response = await fetch(url, { headers: { 'X-RESQ-Authority-Key': authorityKey } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

class CommunityAlertServiceClass {
  installationId = '';
  ownedAlertIds = new Set();

  async getInstallationId() {
    if (this.installationId) return this.installationId;
    let value = await AsyncStorage.getItem('resqInstallationId');
    if (!value) {
      value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      await AsyncStorage.setItem('resqInstallationId', value);
    }
    this.installationId = value;
    return value;
  }

  isOwnedAlert(alertId) {
    return Boolean(alertId && this.ownedAlertIds.has(alertId));
  }

  async registerForPushAsync() {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(COMMUNITY_CHANNEL_ID, {
        name: 'RESQ 360 Emergency Alerts',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        enableVibrate: true,
        vibrationPattern: [0, 500, 200, 500, 200, 800],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        lightColor: '#FF1744',
      });
    }

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }

    if (status !== 'granted') {
      throw new Error('Notification permission not granted');
    }

    const projectId = resolveProjectId() || FALLBACK_EAS_PROJECT_ID;

    try {
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      return token.data;
    } catch (error) {
      const message = error?.message || String(error);

      if (/projectid/i.test(message)) {
        throw new Error(`Could not register this phone for community alerts yet: ${message}`);
      }

      throw error;
    }
  }

  async registerDevice({ serverUrl, pushToken, previousPushToken, label, location }) {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl || !pushToken) return null;

    return postJson(`${baseUrl}/register-token`, {
      token: pushToken,
      previousToken: previousPushToken || '',
      installationId: await this.getInstallationId(),
      label,
      platform: Platform.OS,
      lat: location?.latitude,
      lng: location?.longitude,
    });
  }

  async broadcastSOS({ serverUrl, payload }) {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl) return null;
    if (!payload?.senderToken) throw new Error('Community alert registration is not ready');

    const result = await postJson(`${baseUrl}/broadcast-sos`, {
      ...payload,
      senderInstallationId: await this.getInstallationId(),
    });
    if (result?.alert?.id) this.ownedAlertIds.add(result.alert.id);
    return result;
  }

  async resolveSOS({ serverUrl, alertId, senderToken }) {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl || !alertId) throw new Error('No active community alert to resolve');
    return postJson(`${baseUrl}/resolve-sos`, { alertId, senderToken });
  }

  async acknowledgeSOS({ serverUrl, alertId, responderToken, responderName }) {
    const baseUrl = normalizeUrl(serverUrl);
    return postJson(`${baseUrl}/acknowledge-sos`, { alertId, responderToken, responderName });
  }

  async updateResponderLocation({ serverUrl, alertId, responderToken, location }) {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl || !alertId || !location) throw new Error('Responder location is not available');
    return postJson(`${baseUrl}/update-responder-location`, { alertId, responderToken,
      lat: location.latitude, lng: location.longitude, accuracy: location.accuracy,
      locationTimestamp: new Date(location.timestamp).toISOString() });
  }

  async reportPublicIncident({ serverUrl, incidentType, severity, description, latitude, longitude, demoMode = false }) {
    return postJson(`${normalizeUrl(serverUrl)}/public-incidents`, { incidentType, severity, description, latitude, longitude, demoMode });
  }

  async listPublicIncidents({ serverUrl, authorityKey }) {
    return authorityGet(`${normalizeUrl(serverUrl)}/public-incidents`, authorityKey);
  }

  async listPublicSituations({ serverUrl, authorityKey }) {
    return authorityGet(`${normalizeUrl(serverUrl)}/public-situations`, authorityKey);
  }

  async getPublicSituation({ serverUrl, authorityKey, situationId }) {
    return authorityGet(`${normalizeUrl(serverUrl)}/public-situations/${encodeURIComponent(situationId)}`, authorityKey);
  }

  async getNearbyResources({ serverUrl, authorityKey, incidentId }) {
    return authorityGet(`${normalizeUrl(serverUrl)}/public-incidents/${encodeURIComponent(incidentId)}/nearby-resources`, authorityKey);
  }

  async coordinatePublicResponse({ serverUrl, authorityKey, incidentId, resourceId }) {
    return postJson(`${normalizeUrl(serverUrl)}/public-incidents/${encodeURIComponent(incidentId)}/coordinate`,
      { resourceId }, { 'X-RESQ-Authority-Key': authorityKey });
  }

  async verifyArrival({ serverUrl, alertId, responderToken, responderName }) {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl || !alertId) throw new Error('Alert is not available');
    return postJson(`${baseUrl}/verify-arrival`, { alertId, responderToken, responderName });
  }

  async requestMoreHelp({ serverUrl, alertId, responderToken }) {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl || !alertId) throw new Error('Alert is not available');
    return postJson(`${baseUrl}/request-more-help`, { alertId, responderToken });
  }

  async escalateSOS({ serverUrl, alertId, senderToken, radiusKm }) {
    const baseUrl = normalizeUrl(serverUrl);
    return postJson(`${baseUrl}/escalate-sos`, { alertId, senderToken, radiusKm });
  }

  async updateSOSLocation({ serverUrl, alertId, senderToken, location }) {
    const baseUrl = normalizeUrl(serverUrl);
    return postJson(`${baseUrl}/update-sos-location`, {
      alertId, senderToken, lat: location.latitude, lng: location.longitude, accuracy: location.accuracy,
      locationTimestamp: new Date(location.timestamp).toISOString(),
    });
  }

  async uploadEvidence({ serverUrl, ownerToken, alertId, evidence }) {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl || !ownerToken || !evidence) return null;
    const audioBase64 = evidence.audioUri
      ? await FileSystem.readAsStringAsync(evidence.audioUri, { encoding: FileSystem.EncodingType.Base64 })
      : '';
    const result = await postJson(`${baseUrl}/evidence/upload`, { ownerToken, alertId, evidenceId: evidence.id,
      startedAt: evidence.startedAt, endedAt: evidence.endedAt, locations: evidence.locations || [], audioBase64 });
    return { ...result, accessUrl: result?.accessPath ? `${baseUrl}${result.accessPath}` : '' };
  }

  async deleteEvidence({ serverUrl, ownerToken, duress = false }) {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl || !ownerToken) return null;
    return postJson(`${baseUrl}/evidence/delete`, { ownerToken, duress });
  }

  async getAlertStatus({ serverUrl, alertId }) {
    const baseUrl = normalizeUrl(serverUrl);
    const response = await fetch(`${baseUrl}/alert-status?id=${encodeURIComponent(alertId)}`, {
      headers: { ...(ALERT_API_KEY ? { 'X-SafeGuard-API-Key': ALERT_API_KEY } : {}) },
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json();
  }

  async fetchAlerts({ serverUrl, since }) {
    const baseUrl = normalizeUrl(serverUrl);
    if (!baseUrl) return [];

    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const response = await fetch(`${baseUrl}/alerts${query}`, {
      headers: {
        ...(ALERT_API_KEY ? { 'X-SafeGuard-API-Key': ALERT_API_KEY } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return Array.isArray(data.alerts) ? data.alerts : [];
  }
}

export const CommunityAlertService = new CommunityAlertServiceClass();
