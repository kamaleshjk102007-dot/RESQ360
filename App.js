import React, { useEffect, useRef, useCallback } from 'react';
import { StatusBar, AppState, LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import AppNavigator from './src/navigation/AppNavigator';
import { AppProvider, useAppContext } from './src/store/AppContext';
import { SMSService } from './src/services/SMSService';
import { NotificationService } from './src/services/NotificationService';
import { PermissionsService } from './src/services/PermissionsService';
import { CommunityAlertService } from './src/services/CommunityAlertService';
import { normalizeDisplayName } from './src/utils/displayName';

LogBox.ignoreLogs([
  'Possible unhandled promise rejection',
]);

function AppInner() {
  const { state, dispatch } = useAppContext();
  const appState = useRef(AppState.currentState);
  const navigationRef = useRef(null);
  const lastCommunityAlertIdRef = useRef('');
  const seenRemoteAlertIdsRef = useRef(new Set());

  const broadcastCommunityAlert = useCallback(
    async (eventPayload) => {
      if (!state.alertServerUrl) return;
      try {
        return await CommunityAlertService.broadcastSOS({
          serverUrl: state.alertServerUrl,
          payload: {
            ...eventPayload,
            senderToken: state.expoPushToken,
            senderName: normalizeDisplayName(state.displayName),
          },
        });
      } catch (error) {
        console.warn('[CommunityAlerts] Broadcast failed:', error.message || error);
      }
    },
    [state.alertServerUrl, state.expoPushToken, state.displayName],
  );

  const broadcastRef = useRef(broadcastCommunityAlert);
  useEffect(() => {
    broadcastRef.current = broadcastCommunityAlert;
  }, [broadcastCommunityAlert]);

  // FIXED: This used to dispatch SET_SOS_ACTIVE / SET_LOCATION and navigate to
  // 'Emergency', which hijacked the receiver's own SOS state and location with
  // the sender's data. Now it only records the alert as a remote/community
  // alert and opens the dedicated CommunityAlert screen. It never touches
  // sosActive, triggerSource, or currentLocation.
  //
  // FIXED (2): This handler is also invoked by NotificationService's
  // foreground listener, which fires for ANY notification received while
  // the app is open — including the sender's own local emergency
  // notification (scheduled with trigger: null in
  // NotificationService.sendEmergencyNotification). That local notification
  // was reaching this function and bouncing the sender straight to
  // CommunityAlertScreen right after pressing SOS. The guard below requires
  // payload.remoteBroadcast to be explicitly true — a flag only ever set by
  // the server's push payload or by the poll loop for genuine remote
  // alerts — so the sender's own local notification is now a no-op here.
  const handleIncomingCommunityAlert = useCallback(
    (payload = {}) => {
      // Only ever act on genuine remote broadcasts. The sender's own local
      // emergency notification fires through this same listener and must
      // never be treated as an incoming community alert.
      if (!payload.remoteBroadcast) return;

      if (CommunityAlertService.isOwnedAlert(payload.alertId)) return;

      if (payload.safeResolved && payload.alertId) {
        dispatch({ type: 'RESOLVE_REMOTE_ALERT', payload: { alertId: payload.alertId, resolvedAt: payload.resolvedAt } });
        return;
      }

      if (payload.evidenceUpdate && payload.alertId) {
        dispatch({ type: 'UPDATE_REMOTE_ALERT', payload: { alertId: payload.alertId, evidenceLinks: payload.evidenceLinks || [] } });
        return;
      }

      if (payload?.lat === undefined || payload?.lng === undefined) return;

      // Never process our own broadcast (belt-and-suspenders alongside the
      // server-side filter and the poll-loop check below).
      if (payload.senderToken && payload.senderToken === state.expoPushToken) return;

      const alertId = payload.alertId || `${payload.senderToken || 'unknown'}-${payload.timestamp || Date.now()}`;

      // De-dupe across push-notification delivery and poll-based delivery.
      if (seenRemoteAlertIdsRef.current.has(alertId)) {
        dispatch({ type: 'UPDATE_REMOTE_ALERT', payload: {
          alertId, lat: Number(payload.lat), lng: Number(payload.lng), accuracy: payload.accuracy,
          locationUpdatedAt: payload.locationUpdatedAt, acknowledgements: payload.acknowledgements || [],
        } });
        return;
      }
      seenRemoteAlertIdsRef.current.add(alertId);

      const remoteAlert = {
        alertId,
        lat: Number(payload.lat),
        lng: Number(payload.lng),
        source: payload.source || 'APP_USER',
        timestamp: payload.timestamp || new Date().toISOString(),
        senderToken: payload.senderToken || '',
        senderName: normalizeDisplayName(payload.senderName),
        accuracy: payload.accuracy,
        locationUpdatedAt: payload.locationUpdatedAt,
        acknowledgements: payload.acknowledgements || [],
      };

      dispatch({ type: 'ADD_REMOTE_ALERT', payload: remoteAlert });

      // Still logged to History, clearly tagged as a remote event — distinct
      // from the local user's own SOS history entries.
      dispatch({
        type: 'ADD_HISTORY_EVENT',
        payload: { ...remoteAlert, remoteBroadcast: true },
      });

      navigationRef.current?.navigate('CommunityAlert');
    },
    [dispatch, state.expoPushToken],
  );

  useEffect(() => {
    async function initializeApp() {
      try {
        await PermissionsService.requestAll();
      } catch (error) {
        console.error('[App] Permission initialization failed:', error);
      }

      try {
        await NotificationService.initialize();
        const coldStartAlert = await NotificationService.getLastResponseData();
        if (coldStartAlert?.remoteBroadcast) {
          handleIncomingCommunityAlert(coldStartAlert);
        }
      } catch (error) {
        console.error('[App] Notification initialization failed:', error);
      }

      // Local SOS trigger path (unchanged): incoming SMS on THIS phone means
      // THIS phone's user is in danger — sosActive/EmergencyScreen is correct here.
      SMSService.startListening((smsData) => {
        const timestamp = new Date().toISOString();
        console.log('[App] SMS SOS received:', smsData);
        dispatch({ type: 'SET_SOS_ACTIVE', payload: true });
        dispatch({ type: 'SET_TRIGGER_SOURCE', payload: 'SMS' });
        dispatch({ type: 'SET_LOCATION', payload: { latitude: smsData.lat, longitude: smsData.lng } });
        dispatch({ type: 'ADD_HISTORY_EVENT', payload: { ...smsData, source: 'SMS', timestamp } });

        NotificationService.sendEmergencyNotification({ ...smsData, source: 'SMS', timestamp }).catch((error) => {
          console.error('[App] Failed to send SMS emergency notification:', error);
        });

        broadcastRef.current({ ...smsData, source: 'SMS', timestamp })
          .then(result => {
            if (result?.alert?.id) dispatch({ type: 'SET_ACTIVE_ALERT_ID', payload: result.alert.id });
          })
          .catch(() => {});

        navigationRef.current?.navigate('Emergency');
      });
    }

    initializeApp();
    NotificationService.subscribe(handleIncomingCommunityAlert);

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
      SMSService.stopListening();
      NotificationService.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleIncomingCommunityAlert]);

  useEffect(() => {
    async function registerCurrentDevice() {
      if (!state.alertServerUrl) return;
      try {
        const pushToken = await CommunityAlertService.registerForPushAsync();
        dispatch({ type: 'SET_EXPO_PUSH_TOKEN', payload: pushToken });
        await CommunityAlertService.registerDevice({
          serverUrl: state.alertServerUrl,
          pushToken,
          previousPushToken: state.expoPushToken,
          label: 'RESQ 360 User',
          location: state.currentLocation,
        });
      } catch (error) {
        console.warn('[CommunityAlerts] Registration skipped:', error.message || error);
      }
    }

    registerCurrentDevice();
  }, [state.alertServerUrl, state.currentLocation, dispatch]);

  useEffect(() => {
    if (!state.alertServerUrl) return undefined;

    let cancelled = false;

    async function pollCommunityAlerts() {
      try {
        const alerts = await CommunityAlertService.fetchAlerts({
          serverUrl: state.alertServerUrl,
          since: lastCommunityAlertIdRef.current,
        });
        if (cancelled || alerts.length === 0) return;

        const newestFirst = [...alerts].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        for (const alert of newestFirst) {
          if (!alert?.id) continue;
          lastCommunityAlertIdRef.current = alert.id;

          if (alert.safeResolved) {
            handleIncomingCommunityAlert({ remoteBroadcast: true, safeResolved: true, alertId: alert.targetAlertId, resolvedAt: alert.resolvedAt });
            continue;
          }
          if (alert.evidenceUpdate) {
            handleIncomingCommunityAlert({ remoteBroadcast: true, evidenceUpdate: true,
              alertId: alert.targetAlertId, evidenceLinks: alert.evidenceLinks || [] });
            continue;
          }
          if (alert.locationUpdate) {
            handleIncomingCommunityAlert({ remoteBroadcast: true, alertId: alert.targetAlertId, lat: alert.lat, lng: alert.lng, accuracy: alert.accuracy, locationUpdatedAt: alert.locationUpdatedAt });
            continue;
          }

          // Skip our own broadcast surfaced back via polling.
          if (CommunityAlertService.isOwnedAlert(alert.id) || (alert.senderToken && alert.senderToken === state.expoPushToken)) continue;

          handleIncomingCommunityAlert({
            ...alert,
            alertId: alert.id,
            remoteBroadcast: true,
          });
        }
      } catch (error) {
        console.warn('[CommunityAlerts] Poll skipped:', error.message || error);
      }
    }

    pollCommunityAlerts();
    const timer = setInterval(pollCommunityAlerts, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state.alertServerUrl, state.expoPushToken, handleIncomingCommunityAlert]);

  return (
    <NavigationContainer ref={navigationRef}>
      <StatusBar barStyle="light-content" backgroundColor="#06131F" />
      <AppNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <AppInner />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
