import React, { createContext, useContext, useReducer, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALERT_SERVER_URL } from '../config';

const AppContext = createContext(null);

const initialState = {
  // Local emergency (this device's own SOS)
  sosActive: false,
  triggerSource: null, // 'SMS' | 'MANUAL'

  // Location
  currentLocation: null, // { latitude, longitude }
  locationAddress: null,

  // Remote / community alerts (other users' SOS — never touches sosActive/currentLocation)
  remoteAlerts: [], // [{ alertId, lat, lng, source, timestamp, senderToken, senderName }], newest first

  // Contacts
  contacts: [],

  // History
  historyEvents: [],

  // Settings
  smsNumber: '',
  alertServerUrl: ALERT_SERVER_URL,
  expoPushToken: '',
  displayName: '',
  safetyPasskey: '',
  activeAlertId: '',
  emergencyCallIndex: -1,
  duressPasskey: '',
  deliveryStatus: { community: 'idle', sms: 'idle', call: 'idle', recipients: 0, smsSent: 0 },
  language: 'en',
  evidenceConsent: false,
  evidenceVault: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_SOS_ACTIVE':
      return { ...state, sosActive: action.payload };
    case 'SET_TRIGGER_SOURCE':
      return { ...state, triggerSource: action.payload };
    case 'SET_LOCATION':
      return { ...state, currentLocation: action.payload };
    case 'SET_LOCATION_ADDRESS':
      return { ...state, locationAddress: action.payload };

    case 'ADD_REMOTE_ALERT': {
      const alert = action.payload;
      const id = alert?.alertId;
      // De-dupe: ignore if we've already recorded this alertId (covers push + poll double-delivery)
      if (id && state.remoteAlerts.some(a => a.alertId === id)) {
        return state;
      }
      return {
        ...state,
        remoteAlerts: [alert, ...state.remoteAlerts].slice(0, 20),
      };
    }
    case 'DISMISS_REMOTE_ALERT':
      return {
        ...state,
        remoteAlerts: state.remoteAlerts.filter(a => a.alertId !== action.payload),
      };
    case 'CLEAR_REMOTE_ALERTS':
      return { ...state, remoteAlerts: [] };

    case 'SET_CONTACTS':
      return { ...state, contacts: action.payload };
    case 'ADD_CONTACT':
      return { ...state, contacts: [...state.contacts, action.payload] };
    case 'UPDATE_CONTACT':
      return {
        ...state,
        contacts: state.contacts.map(c =>
          c.id === action.payload.id ? action.payload : c
        ),
      };
    case 'DELETE_CONTACT':
      return {
        ...state,
        contacts: state.contacts.filter(c => c.id !== action.payload),
      };
    case 'SET_HISTORY':
      return { ...state, historyEvents: action.payload };
    case 'ADD_HISTORY_EVENT':
      return {
        ...state,
        historyEvents: [action.payload, ...state.historyEvents].slice(0, 100),
      };
    case 'CLEAR_HISTORY':
      return { ...state, historyEvents: [] };
    case 'SET_SMS_NUMBER':
      return { ...state, smsNumber: action.payload };
    case 'SET_EXPO_PUSH_TOKEN':
      return { ...state, expoPushToken: action.payload };
    case 'SET_DISPLAY_NAME':
      return { ...state, displayName: action.payload };
    case 'SET_SAFETY_PASSKEY':
      return { ...state, safetyPasskey: action.payload };
    case 'SET_ACTIVE_ALERT_ID':
      return { ...state, activeAlertId: action.payload || '' };
    case 'SET_EMERGENCY_CALL_INDEX':
      return { ...state, emergencyCallIndex: action.payload };
    case 'SET_DURESS_PASSKEY':
      return { ...state, duressPasskey: action.payload };
    case 'SET_DELIVERY_STATUS':
      return { ...state, deliveryStatus: { ...state.deliveryStatus, ...action.payload } };
    case 'SET_LANGUAGE': return { ...state, language: action.payload };
    case 'SET_EVIDENCE_CONSENT': return { ...state, evidenceConsent: action.payload };
    case 'SET_EVIDENCE_VAULT': return { ...state, evidenceVault: action.payload };
    case 'ADD_EVIDENCE': return { ...state, evidenceVault: [action.payload, ...state.evidenceVault].slice(0, 360) };
    case 'UPDATE_EVIDENCE': return { ...state, evidenceVault: state.evidenceVault.map(item => item.id === action.payload.id ? { ...item, ...action.payload } : item) };
    case 'UPDATE_REMOTE_ALERT':
      return { ...state, remoteAlerts: state.remoteAlerts.map(a => a.alertId === action.payload.alertId ? { ...a, ...action.payload } : a) };
    case 'RESOLVE_REMOTE_ALERT':
      return {
        ...state,
        remoteAlerts: state.remoteAlerts.map(a =>
          a.alertId === action.payload.alertId
            ? { ...a, resolved: true, resolvedAt: action.payload.resolvedAt }
            : a
        ),
      };
    case 'DISMISS_SOS':
      return { ...state, sosActive: false, triggerSource: null, activeAlertId: '', emergencyCallIndex: -1, deliveryStatus: initialState.deliveryStatus };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Load persisted data on mount
  useEffect(() => {
    loadPersistedData();
  }, []);

  // Persist contacts & history on change
  useEffect(() => {
    AsyncStorage.setItem('contacts', JSON.stringify(state.contacts));
  }, [state.contacts]);

  useEffect(() => {
    AsyncStorage.setItem('history', JSON.stringify(state.historyEvents));
  }, [state.historyEvents]);

  useEffect(() => { AsyncStorage.setItem('evidenceVault', JSON.stringify(state.evidenceVault)); }, [state.evidenceVault]);

  useEffect(() => {
    AsyncStorage.setItem('smsNumber', state.smsNumber || '');
    AsyncStorage.setItem('expoPushToken', state.expoPushToken || '');
    AsyncStorage.setItem('displayName', state.displayName || '');
    AsyncStorage.setItem('safetyPasskey', state.safetyPasskey || '');
    AsyncStorage.setItem('duressPasskey', state.duressPasskey || '');
    AsyncStorage.setItem('language', state.language);
    AsyncStorage.setItem('evidenceConsent', state.evidenceConsent ? 'true' : 'false');
  }, [state.smsNumber, state.expoPushToken, state.displayName, state.safetyPasskey, state.duressPasskey, state.language, state.evidenceConsent]);

  async function loadPersistedData() {
    try {
      const contacts = await AsyncStorage.getItem('contacts');
      const history = await AsyncStorage.getItem('history');
      const smsNumber = await AsyncStorage.getItem('smsNumber');
      const expoPushToken = await AsyncStorage.getItem('expoPushToken');
      const displayName = await AsyncStorage.getItem('displayName');
      const safetyPasskey = await AsyncStorage.getItem('safetyPasskey');
      const duressPasskey = await AsyncStorage.getItem('duressPasskey');
      const language = await AsyncStorage.getItem('language');
      const evidenceConsent = await AsyncStorage.getItem('evidenceConsent');
      const evidenceVault = await AsyncStorage.getItem('evidenceVault');

      if (contacts) dispatch({ type: 'SET_CONTACTS', payload: JSON.parse(contacts) });
      if (history) dispatch({ type: 'SET_HISTORY', payload: JSON.parse(history) });
      if (smsNumber) dispatch({ type: 'SET_SMS_NUMBER', payload: smsNumber });
      if (expoPushToken) dispatch({ type: 'SET_EXPO_PUSH_TOKEN', payload: expoPushToken });
      if (displayName) dispatch({ type: 'SET_DISPLAY_NAME', payload: displayName });
      if (safetyPasskey) dispatch({ type: 'SET_SAFETY_PASSKEY', payload: safetyPasskey });
      if (duressPasskey) dispatch({ type: 'SET_DURESS_PASSKEY', payload: duressPasskey });
      if (language) dispatch({ type: 'SET_LANGUAGE', payload: language });
      if (evidenceConsent) dispatch({ type: 'SET_EVIDENCE_CONSENT', payload: evidenceConsent === 'true' });
      if (evidenceVault) dispatch({ type: 'SET_EVIDENCE_VAULT', payload: JSON.parse(evidenceVault) });
    } catch (e) {
      console.error('[AppContext] Failed to load persisted data:', e);
    }
  }

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
