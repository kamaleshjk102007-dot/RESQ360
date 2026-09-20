import { Platform, PermissionsAndroid, Alert } from 'react-native';
import * as Location from 'expo-location';

export const PermissionsService = {
  async requestAll() {
    if (Platform.OS !== 'android') return;

    const permissions = [];

    // Location
    const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
    if (locStatus !== 'granted') {
      console.warn('[Permissions] Location not granted');
    }

    // Background location
    const { status: bgLocStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgLocStatus !== 'granted') {
      console.warn('[Permissions] Background location not granted');
    }

    // SMS permissions
    permissions.push(
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
    );

    try {
      const results = await PermissionsAndroid.requestMultiple(permissions);
      console.log('[Permissions] Results:', results);

      const denied = Object.entries(results)
        .filter(([, v]) => v !== PermissionsAndroid.RESULTS.GRANTED)
        .map(([k]) => k);

      if (denied.length > 0) {
        console.warn('[Permissions] Denied:', denied);
        Alert.alert(
          'Permissions Required',
          `RESQ 360 needs the following permissions for emergency detection:\n\n${denied
            .map(p => p.split('.').pop())
            .join(', ')}\n\nPlease grant these in Settings.`,
          [{ text: 'OK' }]
        );
      }
    } catch (err) {
      console.error('[Permissions] Error:', err);
    }
  },

  async hasSMSPermission() {
    if (Platform.OS !== 'android') return false;
    return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  },
};
