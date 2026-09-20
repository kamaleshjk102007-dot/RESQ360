import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
  ScrollView,
  StatusBar,
  NativeModules,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

import { useAppContext } from '../store/AppContext';
import { NotificationService } from '../services/NotificationService';
import { CommunityAlertService } from '../services/CommunityAlertService';
import { normalizeDisplayName } from '../utils/displayName';
import { t } from '../utils/i18n';

const COLORS = {
  bg: '#06131F',
  card: '#0C2233',
  border: '#1C4057',
  primary: '#00C2A8',
  green: '#36D399',
  orange: '#FFB020',
  text: '#F4FAFC',
  muted: '#91A9B8',
  subtext: '#607D8B',
};

export default function HomeScreen() {
  const { state, dispatch } = useAppContext();
  const navigation = useNavigation();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const [locationText, setLocationText] = useState('Fetching location...');

  // Pulse animation for SOS button
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Fetch location
  useEffect(() => {
    fetchCurrentLocation();
    const interval = setInterval(fetchCurrentLocation, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchCurrentLocation() {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = loc.coords;
      dispatch({ type: 'SET_LOCATION', payload: { latitude, longitude, accuracy: loc.coords.accuracy, timestamp: loc.timestamp } });

      const [addr] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (addr) {
        const text = [addr.street, addr.district, addr.city].filter(Boolean).join(', ');
        setLocationText(text || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        dispatch({ type: 'SET_LOCATION_ADDRESS', payload: text });
      }
    } catch (e) {
      setLocationText('Location unavailable');
    }
  }

  async function handleManualSOS() {
    const timestamp = new Date().toISOString();
    const senderName = normalizeDisplayName(state.displayName);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Vibration.vibrate([0, 300, 100, 300, 100, 500]);
    dispatch({ type: 'SET_SOS_ACTIVE', payload: true });
    dispatch({ type: 'SET_TRIGGER_SOURCE', payload: 'MANUAL' });
    dispatch({ type: 'SET_DELIVERY_STATUS', payload: { community: 'sending', sms: 'sending', call: 'calling', recipients: 0, smsSent: 0 } });
    dispatch({
      type: 'ADD_HISTORY_EVENT',
      payload: {
        source: 'MANUAL',
        lat: state.currentLocation?.latitude,
        lng: state.currentLocation?.longitude,
        timestamp,
      },
    });
    NotificationService.sendEmergencyNotification({
      lat: state.currentLocation?.latitude,
      lng: state.currentLocation?.longitude,
      source: 'MANUAL',
      timestamp,
    }).catch(() => {});
    navigation.navigate('Emergency');

    const firstContact = state.contacts[0];
    if (firstContact?.phone) {
      dispatch({ type: 'SET_EMERGENCY_CALL_INDEX', payload: 0 });
      NativeModules.EmergencyCall?.callNumbers([firstContact.phone]).catch((error) => {
        dispatch({ type: 'SET_DELIVERY_STATUS', payload: { call: 'failed' } });
        dispatch({ type: 'SET_EMERGENCY_CALL_INDEX', payload: -1 });
        Alert.alert('Automatic Call Failed', error.message || `Could not call ${firstContact.name}.`);
      });
    } else {
      dispatch({ type: 'SET_DELIVERY_STATUS', payload: { call: 'not-configured' } });
    }

    const contactNumbers = state.contacts.map(contact => contact.phone).filter(Boolean);
    if (contactNumbers.length > 0) {
      const lat = state.currentLocation?.latitude;
      const lng = state.currentLocation?.longitude;
      const mapLink = lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : 'Location unavailable';
      NativeModules.EmergencySms?.sendToAll(contactNumbers, `${t(state.language, 'sosSms', senderName)} ${mapLink}`)
        .then(count => dispatch({ type: 'SET_DELIVERY_STATUS', payload: { sms: 'sent', smsSent: Number(count) || 0 } }))
        .catch(() => dispatch({ type: 'SET_DELIVERY_STATUS', payload: { sms: 'failed' } }));
    } else {
      dispatch({ type: 'SET_DELIVERY_STATUS', payload: { sms: 'not-configured' } });
    }

    try {
      let senderToken = state.expoPushToken;
      if (!senderToken) {
        senderToken = await CommunityAlertService.registerForPushAsync();
        dispatch({ type: 'SET_EXPO_PUSH_TOKEN', payload: senderToken });
        await CommunityAlertService.registerDevice({
          serverUrl: state.alertServerUrl,
          pushToken: senderToken,
          previousPushToken: state.expoPushToken,
          label: 'RESQ 360 User',
          location: state.currentLocation,
        });
      }
      const result = await CommunityAlertService.broadcastSOS({
        serverUrl: state.alertServerUrl,
        payload: {
        lat: state.currentLocation?.latitude,
        lng: state.currentLocation?.longitude,
        source: 'MANUAL',
        timestamp,
        accuracy: state.currentLocation?.accuracy,
        locationTimestamp: state.currentLocation?.timestamp ? new Date(state.currentLocation.timestamp).toISOString() : null,
        senderToken,
        senderName,
        language: state.language,
        },
      });
      if (result?.alert?.id) dispatch({ type: 'SET_ACTIVE_ALERT_ID', payload: result.alert.id });
      dispatch({ type: 'SET_DELIVERY_STATUS', payload: { community: 'sent', recipients: result?.recipients || 0 } });
    } catch (error) {
      dispatch({ type: 'SET_DELIVERY_STATUS', payload: { community: 'failed' } });
      Alert.alert('Community Alert Failed', error.message || 'Other app users may not have received this SOS.');
    }
  }

  const connectionColor = COLORS.green;
  const connectionIcon = 'shield-checkmark';
  const connectionText = 'App Ready - SOS Armed';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}><Ionicons name="shield-checkmark" size={18} color="#06131F" /></View>
            <Text style={styles.appName}>RESQ <Text style={styles.appNameAccent}>360</Text></Text>
          </View>
          <Text style={styles.tagline}>PERSONAL EMERGENCY RESPONSE</Text>
        </View>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')}>
          <Ionicons name="settings-outline" size={22} color={COLORS.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Device Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Animated.View style={[styles.statusDot, { backgroundColor: connectionColor }]} />
            <Ionicons name={connectionIcon} size={16} color={connectionColor} style={{ marginLeft: 8 }} />
            <Text style={[styles.statusText, { color: connectionColor }]}>{connectionText}</Text>
          </View>
        </View>

        {/* SMS Backup Status */}
        <View style={styles.smsCard}>
          <Ionicons name="chatbubble-outline" size={14} color={COLORS.muted} />
          <Text style={styles.smsText}>SMS Backup: Native receiver enabled</Text>
        </View>

        {/* Location Card */}
        <View style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <Ionicons name="location" size={16} color={COLORS.primary} />
            <Text style={styles.locationLabel}>Last Known Location</Text>
          </View>
          <Text style={styles.locationText}>{locationText}</Text>
          {state.currentLocation && (
            <Text style={styles.coordText}>
              {state.currentLocation.latitude.toFixed(5)}, {state.currentLocation.longitude.toFixed(5)}
            </Text>
          )}
        </View>

        {/* Big SOS Button */}
        <View style={styles.sosContainer}>
          <Text style={styles.sosLabel}>PRESS FOR EMERGENCY</Text>

          <View style={styles.sosStage}>
            {/* Every ring and the button use this one fixed center point. */}
            <Animated.View style={[styles.sosRing3]} />
            <Animated.View style={[styles.sosRing2]} />
            <Animated.View style={[styles.sosRing1]} />

            <Animated.View style={[styles.sosButtonWrap, { transform: [{ scale: pulseAnim }] }]}>
              <TouchableOpacity
                style={styles.sosButton}
                onPress={handleManualSOS}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Send emergency SOS"
              >
                <Ionicons name="alert-circle" size={52} color="#fff" />
                <Text style={styles.sosButtonText}>SOS</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>

          <Text style={styles.sosHint}>Tap to alert your contacts</Text>
        </View>

        {/* Quick Stats */}
        <TouchableOpacity style={styles.publicAction} onPress={() => navigation.navigate('PublicEmergency')} accessibilityRole="button">
          <Ionicons name="megaphone-outline" size={20} color="#fff" />
          <Text style={styles.publicActionText}>REPORT PUBLIC EMERGENCY</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.authorityAction} onPress={() => navigation.navigate('AuthorityResources')} accessibilityRole="button">
          <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.primary} />
          <Text style={styles.authorityActionText}>Authority resource view</Text>
        </TouchableOpacity>

        {/* Quick Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Ionicons name="people" size={20} color={COLORS.primary} />
            <Text style={styles.statNumber}>{state.contacts.length}</Text>
            <Text style={styles.statLabel}>Contacts</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="time" size={20} color={COLORS.orange} />
            <Text style={styles.statNumber}>{state.historyEvents.length}</Text>
            <Text style={styles.statLabel}>Alerts</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="shield-checkmark" size={20} color={COLORS.green} />
            <Text style={styles.statNumber}>ON</Text>
            <Text style={styles.statLabel}>Guard</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  publicAction:{minHeight:48,borderRadius:10,backgroundColor:'#D32F2F',marginTop:20,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  publicActionText:{color:'#fff',fontSize:12,fontWeight:'800'},
  authorityAction:{minHeight:44,borderRadius:10,borderWidth:1,borderColor:COLORS.border,marginTop:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  authorityActionText:{color:COLORS.primary,fontSize:12,fontWeight:'700'},
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  appName: { fontSize: 22, fontWeight: '800', color: COLORS.text, letterSpacing: 0.2 },
  appNameAccent: { color: COLORS.primary },
  tagline: { fontSize: 11, color: COLORS.muted, marginTop: 1, letterSpacing: 1 },
  settingsBtn: { padding: 8 },

  statusCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '600', marginLeft: 6 },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ff174420',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  rescanText: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },

  smsCard: {
    backgroundColor: '#0d1117',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  smsText: { color: COLORS.muted, fontSize: 11 },

  locationCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  locationHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  locationLabel: { fontSize: 11, color: COLORS.muted, letterSpacing: 0.8, textTransform: 'uppercase' },
  locationText: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  coordText: { fontSize: 11, color: COLORS.subtext, marginTop: 3, fontFamily: 'monospace' },

  sosContainer: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 8,
    position: 'relative',
  },
  sosStage: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sosLabel: {
    fontSize: 11,
    letterSpacing: 2.5,
    color: COLORS.muted,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  sosRing3: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 1,
    borderColor: '#00C2A822',
  },
  sosRing2: {
    position: 'absolute',
    top: 20,
    left: 20,
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#00C2A838',
  },
  sosRing1: {
    position: 'absolute',
    top: 40,
    left: 40,
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: '#00C2A855',
  },
  sosButtonWrap: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center' },
  sosButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 20,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
  },
  sosButtonText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: -4,
  },
  sosHint: {
    color: COLORS.subtext,
    fontSize: 11,
    marginTop: 28,
    letterSpacing: 0.3,
  },

  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  statNumber: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  statLabel: { fontSize: 10, color: COLORS.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
});
