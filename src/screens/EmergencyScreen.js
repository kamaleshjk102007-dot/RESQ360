import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Vibration,
  Linking,
  ScrollView,
  StatusBar,
  Modal,
  TextInput,
  Alert,
  NativeModules,
  AppState,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as KeepAwake from 'expo-keep-awake';
import * as Location from 'expo-location';

import { useAppContext } from '../store/AppContext';
import { CommunityAlertService } from '../services/CommunityAlertService';
import { EvidenceService } from '../services/EvidenceService';
import { t } from '../utils/i18n';

const COLORS = {
  bg: '#160B13',
  card: '#25121C',
  border: '#5B2635',
  primary: '#FF4D5E',
  text: '#ffffff',
  muted: '#ff8a80',
};

export default function EmergencyScreen() {
  const { state, dispatch } = useAppContext();
  const navigation = useNavigation();
  const flashAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [passkeyVisible, setPasskeyVisible] = useState(false);
  const [passkeyEntry, setPasskeyEntry] = useState('');
  const [endingAlert, setEndingAlert] = useState(false);
  const [evidenceRecording, setEvidenceRecording] = useState(false);
  const callAppState = useRef(AppState.currentState);
  const callWasBackgrounded = useRef(false);
  const nextCallPromptVisible = useRef(false);
  const escalatedRadiusRef = useRef(1);

  async function persistEvidence(evidence) {
    if (!evidence) return;
    dispatch({ type: 'ADD_EVIDENCE', payload: { ...evidence, backupStatus: 'syncing' } });
    try {
      const result = await CommunityAlertService.uploadEvidence({ serverUrl: state.alertServerUrl, ownerToken: state.expoPushToken,
        alertId: state.activeAlertId, evidence });
      dispatch({ type: 'UPDATE_EVIDENCE', payload: { id: evidence.id, backupStatus: result ? 'backed_up' : 'local_only', uploadedAt: result?.uploadedAt } });
      if (result?.accessUrl) {
        const contactNumbers = state.contacts.map(contact => contact.phone).filter(Boolean);
        if (contactNumbers.length > 0) {
          await NativeModules.EmergencySms?.sendToAll(contactNumbers,
            `RESQ 360 evidence audio · part ${Number(evidence.chunkIndex) + 1}: ${result.accessUrl}`).catch(() => {});
        }
      }
    } catch (_) {
      dispatch({ type: 'UPDATE_EVIDENCE', payload: { id: evidence.id, backupStatus: 'local_only' } });
    }
  }

  useEffect(() => {
    KeepAwake.activateKeepAwakeAsync().catch(() => {});
    startAnimations();
    startVibrationPattern();

    const timer = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    return () => {
      clearInterval(timer);
      Vibration.cancel();
      KeepAwake.deactivateKeepAwake().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!dismissed) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [dismissed]);

  useEffect(() => {
    if (!state.evidenceConsent || !state.sosActive) return undefined;
    let active = true;
    EvidenceService.start().then(() => {
      if (!active) { EvidenceService.stop().catch(() => {}); return; }
      setEvidenceRecording(true);
      const timer = setInterval(() => {
        EvidenceService.rotate().then(persistEvidence).catch(() => {});
      }, 10000);
      EvidenceService.recordingTimer = timer;
    }).catch(error => Alert.alert('Evidence Recording Unavailable', error.message || 'Microphone permission is required.'));
    return () => {
      active = false;
      clearInterval(EvidenceService.recordingTimer);
      EvidenceService.stop().then(persistEvidence).catch(() => {});
    };
  }, [state.evidenceConsent, state.sosActive, dispatch]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = callAppState.current;
      callAppState.current = nextState;

      if (nextState === 'background' || nextState === 'inactive') {
        callWasBackgrounded.current = true;
        return;
      }

      if (
        nextState === 'active' &&
        previousState !== 'active' &&
        callWasBackgrounded.current &&
        state.sosActive &&
        state.emergencyCallIndex >= 0 &&
        !nextCallPromptVisible.current
      ) {
        callWasBackgrounded.current = false;
        dispatch({ type: 'SET_DELIVERY_STATUS', payload: { call: 'attempted' } });
        const nextIndex = state.emergencyCallIndex + 1;
        const nextContact = state.contacts[nextIndex];

        if (!nextContact?.phone) {
          dispatch({ type: 'SET_EMERGENCY_CALL_INDEX', payload: -1 });
          Alert.alert('All Contacts Attempted', 'There are no more emergency contacts to call. Your SOS remains active.');
          return;
        }

        nextCallPromptVisible.current = true;
        Alert.alert(
          'Call Next Contact?',
          `Call ${nextContact.name} at ${nextContact.phone}?`,
          [
            {
              text: 'Stop Calling',
              style: 'cancel',
              onPress: () => {
                nextCallPromptVisible.current = false;
                dispatch({ type: 'SET_EMERGENCY_CALL_INDEX', payload: -1 });
              },
            },
            {
              text: 'Call Next',
              onPress: () => {
                nextCallPromptVisible.current = false;
                dispatch({ type: 'SET_EMERGENCY_CALL_INDEX', payload: nextIndex });
                NativeModules.EmergencyCall?.callNumbers([nextContact.phone]).catch((error) => {
                  Alert.alert('Call Failed', error.message || `Could not call ${nextContact.name}.`);
                });
              },
            },
          ],
          { cancelable: false },
        );
      }
    });

    return () => subscription.remove();
  }, [state.sosActive, state.emergencyCallIndex, state.contacts, dispatch]);

  useEffect(() => {
    if (!state.sosActive || !state.activeAlertId || !state.alertServerUrl) return undefined;
    let subscription;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
      loc => {
        const location = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy, timestamp: loc.timestamp };
        dispatch({ type: 'SET_LOCATION', payload: location });
        EvidenceService.addLocation(location);
        CommunityAlertService.updateSOSLocation({ serverUrl: state.alertServerUrl, alertId: state.activeAlertId, senderToken: state.expoPushToken, location }).catch(() => {});
      },
    ).then(value => { subscription = value; }).catch(() => {});
    const timer = setInterval(() => {
      CommunityAlertService.getAlertStatus({ serverUrl: state.alertServerUrl, alertId: state.activeAlertId })
        .then(result => dispatch({ type: 'SET_DELIVERY_STATUS', payload: { acknowledgements: result.alert?.acknowledgements?.length || 0 } }))
        .catch(() => {});
    }, 5000);
    return () => { subscription?.remove?.(); clearInterval(timer); };
  }, [state.sosActive, state.activeAlertId, state.alertServerUrl, state.expoPushToken, dispatch]);

  useEffect(() => {
    if (!state.activeAlertId || !state.sosActive) return;
    const radiusKm = elapsedSeconds >= 60 ? 10 : elapsedSeconds >= 20 ? 3 : 1;
    if (radiusKm <= escalatedRadiusRef.current) return;
    escalatedRadiusRef.current = radiusKm;
    CommunityAlertService.escalateSOS({ serverUrl: state.alertServerUrl, alertId: state.activeAlertId, senderToken: state.expoPushToken, radiusKm })
      .then(result => dispatch({ type: 'SET_DELIVERY_STATUS', payload: { recipients: result.totalRecipients || 0, radiusKm } }))
      .catch(() => {});
  }, [elapsedSeconds, state.activeAlertId, state.sosActive, state.alertServerUrl, state.expoPushToken, dispatch]);

  function startAnimations() {
    // Flash background
    Animated.loop(
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 600, useNativeDriver: false }),
        Animated.timing(flashAnim, { toValue: 0, duration: 600, useNativeDriver: false }),
      ])
    ).start();

    // Pulse alert icon
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    ).start();

    // Slide in content
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }

  function startVibrationPattern() {
    Vibration.vibrate([0, 500, 200, 500, 200, 500, 1000, 500], true);
  }

  function handleDismiss() {
    if (!state.safetyPasskey) {
      Alert.alert('Set a Safety Passkey', 'Create your I’m Safe passkey in Settings before ending an SOS.');
      return;
    }
    setPasskeyEntry('');
    setPasskeyVisible(true);
  }

  async function confirmSafe() {
    if (state.duressPasskey && passkeyEntry === state.duressPasskey) {
      NativeModules.EmergencyCall?.cancelCalls();
      Vibration.cancel();
      setPasskeyVisible(false);
      setDismissed(true);
      return;
    }
    if (passkeyEntry !== state.safetyPasskey) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert('Incorrect Passkey', 'The SOS remains active. Try again.');
      return;
    }
    setEndingAlert(true);
    try {
      if (state.activeAlertId && state.alertServerUrl) {
        await CommunityAlertService.resolveSOS({
          serverUrl: state.alertServerUrl,
          alertId: state.activeAlertId,
          senderToken: state.expoPushToken,
        });
      }
    } catch (error) {
      Alert.alert('Could Not Notify Everyone', `Your SOS is still active. ${error.message || ''}`);
      setEndingAlert(false);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const evidence = await EvidenceService.stop().catch(() => null);
    await persistEvidence(evidence);
    NativeModules.EmergencyCall?.cancelCalls();
    Vibration.cancel();
    dispatch({ type: 'DISMISS_SOS' });
    setDismissed(true);
    setPasskeyVisible(false);
    navigation.goBack();
  }

  function callContact(phone) {
    Linking.openURL(`tel:${phone}`);
  }

  function openMap() {
    if (!state.currentLocation) return;
    const { latitude, longitude } = state.currentLocation;
    Linking.openURL(`geo:${latitude},${longitude}?q=${latitude},${longitude}(SOS Location)`);
  }

  const bgColor = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#160B13', '#25121C'],
  });

  const lat = state.currentLocation?.latitude;
  const lng = state.currentLocation?.longitude;

  const sourceLabel = {
    SMS: 'SMS Alert (GSM)',
    MANUAL: 'Manual (App)',
  }[state.triggerSource] || 'Unknown';

  const elapsed = `${Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`;

  if (dismissed && state.sosActive) {
    return (
      <SafeAreaView style={styles.discreetContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#06131F" />
        <TouchableOpacity style={styles.discreetMark} activeOpacity={1} delayLongPress={2000}
          onLongPress={() => { setDismissed(false); setPasskeyEntry(''); setPasskeyVisible(true); }}>
          <Ionicons name="shield-checkmark" size={34} color="#06131F" />
        </TouchableOpacity>
        <Text style={styles.discreetTitle}>RESQ 360</Text>
        <Text style={styles.discreetMessage}>Safety check completed</Text>
        <Text style={styles.discreetSubtext}>You can close the app.</Text>
      </SafeAreaView>
    );
  }

  return (
    <Animated.View style={[styles.container, { backgroundColor: bgColor }]}>
      <StatusBar barStyle="light-content" backgroundColor="#160B13" />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Alert Header */}
          <Animated.View style={[styles.alertHeader, { transform: [{ translateY: slideAnim }], opacity: opacityAnim }]}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <View style={styles.alertIconBg}>
                <Ionicons name="warning" size={48} color="#fff" />
              </View>
            </Animated.View>

            <Text style={styles.alertTitle}>SOS ALERT</Text>
            <Text style={styles.alertSubtitle}>{t(state.language, 'emergency')}</Text>
            {evidenceRecording && <Text style={styles.recordingBadge}>● RECORDING UNTIL SOS ENDS · SENDING 10s PARTS</Text>}
            <Text style={styles.elapsedText}>{elapsed}</Text>
          </Animated.View>

          {/* Source */}
          <Animated.View style={[styles.sourceCard, { opacity: opacityAnim }]}>
            <Text style={styles.cardLabel}>DELIVERY STATUS</Text>
            <Text style={styles.sourceText}>Community: {state.deliveryStatus.community} ({state.deliveryStatus.recipients || 0})</Text>
            <Text style={styles.sourceText}>SMS: {state.deliveryStatus.sms} ({state.deliveryStatus.smsSent || 0})</Text>
            <Text style={styles.sourceText}>Call: {state.deliveryStatus.call}</Text>
            <Text style={styles.sourceText}>Responders: {state.deliveryStatus.acknowledgements || 0}</Text>
            <Text style={styles.sourceText}>Alert radius: {state.deliveryStatus.radiusKm || 1} km</Text>
          </Animated.View>
          <Animated.View style={[styles.sourceCard, { opacity: opacityAnim }]}>
            <Text style={styles.cardLabel}>TRIGGER SOURCE</Text>
            <Text style={styles.sourceText}>{sourceLabel}</Text>
          </Animated.View>

          {/* Location */}
          <Animated.View style={[styles.locationCard, { opacity: opacityAnim }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="location" size={16} color={COLORS.primary} />
              <Text style={styles.cardLabel}>LOCATION</Text>
            </View>

            {lat !== undefined && lat !== null && lng !== undefined && lng !== null ? (
              <>
                <Text style={styles.coordText}>
                  {lat.toFixed(6)}, {lng.toFixed(6)}
                </Text>
                {state.locationAddress ? (
                  <Text style={styles.addressText}>{state.locationAddress}</Text>
                ) : null}
                <TouchableOpacity style={styles.mapBtn} onPress={openMap}>
                  <Ionicons name="map" size={14} color={COLORS.primary} />
                  <Text style={styles.mapBtnText}>Open in Maps</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.noLocation}>Location not available</Text>
            )}
          </Animated.View>

          {/* Emergency Contacts */}
          {state.contacts.length > 0 && (
            <Animated.View style={[styles.contactsCard, { opacity: opacityAnim }]}>
              <Text style={styles.cardLabel}>EMERGENCY CONTACTS</Text>
              {state.contacts.map((contact) => (
                <TouchableOpacity
                  key={contact.id}
                  style={styles.contactRow}
                  onPress={() => callContact(contact.phone)}
                >
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.contactPhone}>{contact.phone}</Text>
                  </View>
                  <View style={styles.callBtn}>
                    <Ionicons name="call" size={18} color="#fff" />
                  </View>
                </TouchableOpacity>
              ))}
            </Animated.View>
          )}

          {/* Dismiss Button */}
          <Animated.View style={[{ opacity: opacityAnim }]}>
            <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss}>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.dismissText}>{t(state.language, 'safe')}</Text>
            </TouchableOpacity>

            <Text style={styles.dismissWarning}>
              Only dismiss if you are safe
            </Text>
          </Animated.View>

        </ScrollView>
      </SafeAreaView>
      <Modal visible={passkeyVisible} transparent animationType="fade" onRequestClose={() => setPasskeyVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.passkeyCard}>
            <Ionicons name="shield-checkmark" size={36} color="#00c853" />
            <Text style={styles.passkeyTitle}>Confirm You’re Safe</Text>
            <Text style={styles.passkeyHelp}>Enter your saved passkey. Everyone will be notified and this SOS will close automatically.</Text>
            <TextInput
              style={styles.passkeyInput}
              value={passkeyEntry}
              onChangeText={text => setPasskeyEntry(text.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              autoFocus
              placeholder="Passkey"
              placeholderTextColor="#777"
            />
            <TouchableOpacity style={styles.confirmSafeBtn} onPress={confirmSafe} disabled={endingAlert}>
              <Text style={styles.confirmSafeText}>{endingAlert ? 'Notifying everyone…' : 'Confirm I’m Safe'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.keepActiveBtn} onPress={() => setPasskeyVisible(false)} disabled={endingAlert}>
              <Text style={styles.keepActiveText}>Keep SOS Active</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  discreetContainer: { flex: 1, backgroundColor: '#06131F', alignItems: 'center', justifyContent: 'center', padding: 24 },
  discreetMark: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#00C2A8', alignItems: 'center', justifyContent: 'center' },
  discreetTitle: { color: '#F4FAFC', fontSize: 24, fontWeight: '800', marginTop: 20 },
  discreetMessage: { color: '#91A9B8', fontSize: 15, marginTop: 12 },
  discreetSubtext: { color: '#607D8B', fontSize: 12, marginTop: 8 },
  scroll: { padding: 20, paddingTop: 10 },

  alertHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 16,
  },
  alertIconBg: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    elevation: 20,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 30,
  },
  alertTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 2,
  },
  alertSubtitle: {
    fontSize: 12,
    color: COLORS.muted,
    letterSpacing: 4,
    marginTop: 4,
  },
  elapsedText: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12,
    fontFamily: 'monospace',
  },

  sourceCard: {
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
  sourceText: { fontSize: 16, color: COLORS.text, fontWeight: '700' },

  locationCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  coordText: {
    fontSize: 15,
    color: COLORS.text,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  addressText: { fontSize: 12, color: COLORS.muted, marginTop: 4 },
  noLocation: { fontSize: 14, color: COLORS.muted },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#ff174420',
    padding: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  mapBtnText: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },

  contactsCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  contactPhone: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00c853',
    alignItems: 'center',
    justifyContent: 'center',
  },

  dismissBtn: {
    backgroundColor: '#1a2a1a',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#00c85355',
  },
  dismissText: { color: '#00c853', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  dismissWarning: {
    color: COLORS.muted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  recordingBadge: { color: '#fff', backgroundColor: '#b00020', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, fontSize: 10, fontWeight: '800', marginTop: 10 },
  modalOverlay: { flex: 1, backgroundColor: '#000000cc', alignItems: 'center', justifyContent: 'center', padding: 24 },
  passkeyCard: { width: '100%', backgroundColor: '#161616', borderRadius: 20, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#00c85355' },
  passkeyTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 12 },
  passkeyHelp: { color: '#aaa', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  passkeyInput: { width: '100%', backgroundColor: '#222', borderRadius: 12, borderWidth: 1, borderColor: '#444', color: '#fff', fontSize: 22, letterSpacing: 8, textAlign: 'center', padding: 14, marginTop: 20 },
  confirmSafeBtn: { width: '100%', backgroundColor: '#00a843', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  confirmSafeText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  keepActiveBtn: { padding: 14, marginTop: 4 },
  keepActiveText: { color: '#ff8a80', fontSize: 13, fontWeight: '600' },
});
