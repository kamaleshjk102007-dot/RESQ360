import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  Linking,
  ScrollView,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';

import { useAppContext } from '../store/AppContext';
import { normalizeDisplayName } from '../utils/displayName';
import { CommunityAlertService } from '../services/CommunityAlertService';
import { t } from '../utils/i18n';

// Deliberately distinct from EmergencyScreen's red — this is "someone else needs
// help", not "I need help", and should never be visually confusable with it.
const COLORS = {
  bg: '#00121d',
  card: '#001c2e',
  border: '#003a56',
  primary: '#29b6f6',
  text: '#ffffff',
  muted: '#7fb8d6',
};

function formatDate(isoString) {
  if (!isoString) return 'Unknown time';
  const date = new Date(isoString);
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function CommunityAlertScreen() {
  const { state, dispatch } = useAppContext();
  const navigation = useNavigation();

  // Always show the newest remote alert; screen re-renders with the next one
  // in the queue automatically once the current one is dismissed.
  const alert = state.remoteAlerts[0];
  const queuedCount = state.remoteAlerts.length - 1;
  const senderName = normalizeDisplayName(alert?.senderName);
  const acknowledged = alert?.acknowledgements?.some(item => item.token === state.expoPushToken);
  const [arrivalState, setArrivalState] = useState('idle');
  const [arrivalDistance, setArrivalDistance] = useState(null);
  const [arrivalReason, setArrivalReason] = useState(null);
  const [moreHelpSent, setMoreHelpSent] = useState(false);

  useEffect(() => {
    // Vibration lives ONLY here, scoped to this screen instance — never
    // touches the receiver's own SOS state or EmergencyScreen.
    if (alert) {
      Vibration.vibrate([0, 400, 200, 400], true);
    }
    return () => {
      // Stop vibration on unmount (user navigates away without tapping Close)
      Vibration.cancel();
    };
  }, [alert?.alertId]);

  useEffect(() => {
    setArrivalState('idle');
    setArrivalDistance(null);
    setArrivalReason(null);
    setMoreHelpSent(false);
  }, [alert?.alertId]);

  useEffect(() => {
    // If the queue empties out (e.g. all alerts dismissed elsewhere), leave the screen.
    if (!alert) {
      Vibration.cancel();
      if (navigation.canGoBack()) navigation.goBack();
    }
  }, [alert]);

  useEffect(() => {
    if (!alert?.resolved) return undefined;
    Vibration.cancel();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const timer = setTimeout(() => {
      dispatch({ type: 'DISMISS_REMOTE_ALERT', payload: alert.alertId });
    }, 3500);
    return () => clearTimeout(timer);
  }, [alert?.resolved, alert?.alertId, dispatch]);

  function handleDismiss() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Vibration.cancel();
    if (alert?.alertId) {
      dispatch({ type: 'DISMISS_REMOTE_ALERT', payload: alert.alertId });
    }
    // Do NOT navigate away here if more alerts remain — the screen will
    // re-render with the next queued alert. Only leave when the queue is empty
    // (handled by the effect above).
    if (queuedCount <= 0) {
      if (navigation.canGoBack()) navigation.goBack();
    }
  }

  function openMap() {
    if (!alert) return;
    navigation.navigate('Main', { screen: 'Map', params: { alertId: alert.alertId } });
  }

  function openEvidence(path) {
    if (!path || !state.alertServerUrl) return;
    const baseUrl = state.alertServerUrl.trim().replace(/\/+$/, '');
    Linking.openURL(`${baseUrl}${path}`).catch(() => Alert.alert('Audio Unavailable', 'Could not open this evidence audio.'));
  }

  async function acknowledgeAlert() {
    try {
      const result = await CommunityAlertService.acknowledgeSOS({
        serverUrl: state.alertServerUrl,
        alertId: alert.alertId,
        responderToken: state.expoPushToken,
        responderName: normalizeDisplayName(state.displayName),
      });
      dispatch({ type: 'UPDATE_REMOTE_ALERT', payload: { alertId: alert.alertId, acknowledgements: result.acknowledgements || [] } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      navigation.navigate('Main', { screen: 'Map', params: { alertId: alert.alertId } });
    } catch (error) {
      Alert.alert('Could Not Acknowledge', error.message || 'Try again.');
    }
  }

  async function verifyReached() {
    if (!hasLocation) {
      Alert.alert('Location Unavailable', 'The sender location is not available for comparison.');
      return;
    }
    setArrivalState('checking');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Location permission is required to verify arrival.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      await CommunityAlertService.updateResponderLocation({
        serverUrl: state.alertServerUrl, alertId: alert.alertId, responderToken: state.expoPushToken,
        location: { latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: position.coords.accuracy, timestamp: position.timestamp },
      });
      const result = await CommunityAlertService.verifyArrival({
        serverUrl: state.alertServerUrl,
        alertId: alert.alertId,
        responderToken: state.expoPushToken,
        responderName: normalizeDisplayName(state.displayName),
      });
      setArrivalDistance(result.distanceMeters);
      if (result.verified) {
        setArrivalState('verified');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        setArrivalState('failed');
        setArrivalReason(result.reason === 'TOO_FAR'
          ? `You are ${Math.round(result.distanceMeters)} m away. Required: within ${result.thresholdMeters} m.`
          : 'Location is missing, stale or inaccurate. Wait for a better GPS signal.');
        Alert.alert('Arrival Not Verified', result.reason === 'TOO_FAR'
          ? `You are ${Math.round(result.distanceMeters)} m away. Required: within ${result.thresholdMeters} m.`
          : 'Location is missing, stale or inaccurate. Wait for a better GPS signal and retry.');
      }
    } catch (error) {
      setArrivalState('failed');
      setArrivalReason(error.message || 'Network unavailable. Retry when connected.');
      Alert.alert('Arrival Not Verified', error.message || 'Could not compare your GPS location.');
    }
  }

  async function requestMoreHelp() {
    try {
      setArrivalState('sending-help');
      const result = await CommunityAlertService.requestMoreHelp({
        serverUrl: state.alertServerUrl,
        alertId: alert.alertId,
        responderToken: state.expoPushToken,
      });
      setArrivalState('verified');
      setMoreHelpSent(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      Alert.alert('Additional Help Requested', `${result.recipients || 0} community responder(s) were alerted.`);
    } catch (error) {
      setArrivalState('verified');
      Alert.alert('Could Not Request Help', error.message || 'Try again.');
    }
  }

  if (!alert) {
    return <View style={{ flex: 1, backgroundColor: COLORS.bg }} />;
  }

  const hasLocation =
    alert.lat !== undefined && alert.lat !== null && alert.lng !== undefined && alert.lng !== null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.iconBg}>
              <Ionicons name={alert.resolved ? 'shield-checkmark' : 'people'} size={40} color="#fff" />
            </View>
            <Text style={styles.title}>{alert.resolved ? `${senderName} is safe` : 'Community SOS Alert'}</Text>
            <Text style={styles.subtitle}>{alert.resolved ? 'This emergency has ended. Closing automatically…' : 'Someone nearby has triggered an emergency'}</Text>
            {queuedCount > 0 && (
              <Text style={styles.queueBadge}>+{queuedCount} more alert{queuedCount !== 1 ? 's' : ''} waiting</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>SENDER</Text>
            <View style={styles.senderRow}>
              <Ionicons name="person-circle" size={20} color={COLORS.primary} />
              <Text style={styles.senderName}>{senderName}</Text>
            </View>
          </View>

          {Array.isArray(alert.evidenceLinks) && alert.evidenceLinks.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>LIVE EVIDENCE AUDIO</Text>
              <Text style={styles.evidenceHelp}>New 10-second parts appear here while the SOS remains active.</Text>
              {[...alert.evidenceLinks].slice(-5).reverse().map((item, index) => (
                <TouchableOpacity key={item.id} style={styles.evidenceBtn} onPress={() => openEvidence(item.path)}>
                  <Ionicons name="play-circle" size={20} color={COLORS.primary} />
                  <Text style={styles.evidenceText}>Play audio part {alert.evidenceLinks.length - index}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity style={[styles.respondBtn, acknowledged && styles.respondBtnDone]} onPress={acknowledgeAlert} disabled={acknowledged}>
            <Ionicons name={acknowledged ? 'checkmark-circle' : 'navigate'} size={20} color="#fff" />
            <Text style={styles.respondText}>{acknowledged ? t(state.language, 'responding') : "I'M COMING"}</Text>
          </TouchableOpacity>

          <View style={styles.arrivalCard}>
            <View style={styles.arrivalHeader}>
              <View style={[styles.stepIcon, arrivalState === 'verified' && styles.stepIconDone]}>
                <Ionicons name={arrivalState === 'verified' ? 'shield-checkmark' : 'location'} size={20} color="#fff" />
              </View>
              <View style={styles.arrivalCopy}>
                <Text style={styles.arrivalTitle}>{arrivalState === 'verified' ? 'Arrival verified' : 'Reacher verification'}</Text>
                <Text style={styles.arrivalHelp}>
                  {arrivalState === 'verified' ? `GPS match confirmed${arrivalDistance !== null ? ` · ${arrivalDistance} m away` : ''}` : arrivalState === 'failed' ? `Arrival not verified. ${arrivalReason}` : 'Compare your GPS with the live SOS location.'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.reachedBtn, (arrivalState === 'checking' || arrivalState === 'verified') && styles.reachedBtnDone]}
              onPress={verifyReached}
              disabled={arrivalState === 'checking' || arrivalState === 'verified'}
            >
              <Ionicons name={arrivalState === 'checking' ? 'locate' : arrivalState === 'verified' ? 'checkmark-circle' : 'flag'} size={20} color="#fff" />
              <Text style={styles.reachedText}>{arrivalState === 'checking' ? 'COMPARING GPS…' : arrivalState === 'verified' ? 'I REACHED · VERIFIED' : 'I REACHED'}</Text>
            </TouchableOpacity>

            {arrivalState === 'failed' && (
              <TouchableOpacity style={styles.reachedBtn} onPress={() => navigation.navigate('Main', { screen: 'Map', params: { alertId: alert.alertId } })}>
                <Text style={styles.reachedText}>CONTINUE NAVIGATION</Text>
              </TouchableOpacity>
            )}

            {arrivalState === 'verified' && (
              <TouchableOpacity
                style={[styles.moreHelpBtn, moreHelpSent && styles.moreHelpSent]}
                onPress={requestMoreHelp}
                disabled={moreHelpSent}
              >
                <Ionicons name={moreHelpSent ? 'checkmark-circle' : 'megaphone'} size={20} color="#fff" />
                <Text style={styles.moreHelpText}>{moreHelpSent ? 'MORE HELP REQUESTED' : 'NEED MORE HELP'}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>REPORTED</Text>
            <Text style={styles.cardValue}>{formatDate(alert.timestamp)}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>SOURCE</Text>
            <Text style={styles.cardValue}>{alert.source || 'Unknown'}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>LOCATION</Text>
            {hasLocation ? (
              <>
                <Text style={styles.cardValue}>
                  {Number(alert.lat).toFixed(6)}, {Number(alert.lng).toFixed(6)}
                </Text>
                <TouchableOpacity style={styles.mapBtn} onPress={openMap}>
                  <Ionicons name="map" size={16} color={COLORS.primary} />
                  <Text style={styles.mapBtnText}>View Map</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.noLocation}>Location not available</Text>
            )}
          </View>

          <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss}>
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.dismissText}>Close / Dismiss</Text>
          </TouchableOpacity>

          <Text style={styles.note}>
            This is an alert about someone else's emergency. It will not change your own
            location or trigger your own SOS.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 20, paddingTop: 10 },

  header: { alignItems: 'center', paddingVertical: 20, marginBottom: 12 },
  iconBg: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  subtitle: { fontSize: 13, color: COLORS.muted, marginTop: 6, textAlign: 'center' },
  queueBadge: {
    marginTop: 10,
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '700',
    backgroundColor: '#29b6f622',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardLabel: {
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  cardValue: { fontSize: 15, color: COLORS.text, fontWeight: '600', fontFamily: 'monospace' },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  senderName: { fontSize: 18, color: COLORS.text, fontWeight: '800' },
  noLocation: { fontSize: 14, color: COLORS.muted },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#29b6f622',
    padding: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  mapBtnText: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },
  evidenceHelp: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginBottom: 8 },
  evidenceBtn: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12,
    marginTop: 8, borderRadius: 10, backgroundColor: '#29b6f622', borderWidth: 1, borderColor: '#29b6f644' },
  evidenceText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },

  dismissBtn: {
    backgroundColor: '#1a2a1a',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#00c85355',
  },
  respondBtn: { backgroundColor: '#0277bd', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 12 },
  respondBtnDone: { backgroundColor: '#00a843' },
  respondText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  arrivalCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, marginTop: 12, borderWidth: 1, borderColor: '#29b6f655' },
  arrivalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  stepIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0277bd', alignItems: 'center', justifyContent: 'center' },
  stepIconDone: { backgroundColor: '#00a843' },
  arrivalCopy: { flex: 1, marginLeft: 12 },
  arrivalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  arrivalHelp: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  reachedBtn: { minHeight: 52, borderRadius: 14, backgroundColor: '#0277bd', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  reachedBtnDone: { backgroundColor: '#00a843' },
  reachedText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.4 },
  moreHelpBtn: { minHeight: 52, borderRadius: 14, backgroundColor: '#d32f2f', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  moreHelpLocked: { backgroundColor: '#102b3b', borderWidth: 1, borderColor: COLORS.border },
  moreHelpSent: { backgroundColor: '#7b1f1f' },
  moreHelpText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.4 },
  moreHelpTextLocked: { color: COLORS.muted },
  dismissText: { color: '#00c853', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },

  note: {
    color: COLORS.muted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 16,
  },
});
