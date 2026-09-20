import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Linking,
  Switch,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppContext } from '../store/AppContext';
import { SMSService } from '../services/SMSService';
import { CommunityAlertService } from '../services/CommunityAlertService';
import { normalizeDisplayName, MAX_DISPLAY_NAME_LENGTH } from '../utils/displayName';
import { LANGUAGES } from '../utils/i18n';
import { Audio } from 'expo-av';
import { EvidenceService } from '../services/EvidenceService';
import { ALERT_SERVER_URL } from '../config';

const COLORS = {
  bg: '#06131F',
  card: '#0C2233',
  border: '#1C4057',
  primary: '#00C2A8',
  text: '#ffffff',
  muted: '#91A9B8',
  green: '#00e676',
  input: '#1a1a1a',
};

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SettingRow({ icon, iconColor = COLORS.muted, label, value, onPress, isLast }) {
  return (
    <TouchableOpacity
      style={[styles.settingRow, isLast && styles.settingRowLast]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={[styles.settingIconBg, { backgroundColor: iconColor + '22' }]}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <View style={styles.settingInfo}>
        <Text style={styles.settingLabel}>{label}</Text>
        {value ? <Text style={styles.settingValue}>{value}</Text> : null}
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { state, dispatch } = useAppContext();
  const [editingSMS, setEditingSMS] = useState(false);
  const [smsInput, setSmsInput] = useState(state.smsNumber);
  const [displayNameInput, setDisplayNameInput] = useState(state.displayName);
  const [passkeyInput, setPasskeyInput] = useState(state.safetyPasskey);
  const [duressInput, setDuressInput] = useState(state.duressPasskey);
  const [testSMSInput, setTestSMSInput] = useState('SOS ALERT | LAT:12.9716 | LNG:77.5946');
  const [deleteEvidenceVisible, setDeleteEvidenceVisible] = useState(false);
  const [deletePasskey, setDeletePasskey] = useState('');
  const [deletingEvidence, setDeletingEvidence] = useState(false);

  function saveSMSNumber() {
    dispatch({ type: 'SET_SMS_NUMBER', payload: smsInput });
    setEditingSMS(false);
  }

  function saveDisplayName() {
    const normalized = normalizeDisplayName(displayNameInput);
    setDisplayNameInput(normalized);
    dispatch({ type: 'SET_DISPLAY_NAME', payload: normalized });
    Alert.alert('Display Name Saved', `Your SOS alerts will show as "${normalized}".`);
  }

  function saveSafetyPasskey() {
    const value = passkeyInput.replace(/\D/g, '').slice(0, 6);
    if (value.length < 4) {
      Alert.alert('Passkey Required', 'Choose a 4 to 6 digit passkey.');
      return;
    }
    setPasskeyInput(value);
    dispatch({ type: 'SET_SAFETY_PASSKEY', payload: value });
    Alert.alert('Safety Passkey Saved', 'This passkey is now required to end your SOS alert.');
  }

  function saveDuressPasskey() {
    const value = duressInput.replace(/\D/g, '').slice(0, 6);
    if (value.length < 4 || value === state.safetyPasskey) {
      Alert.alert('Invalid Duress Passkey', 'Use a different 4 to 6 digit passkey.');
      return;
    }
    dispatch({ type: 'SET_DURESS_PASSKEY', payload: value });
    setDuressInput(value);
    Alert.alert('Duress Passkey Saved', 'This code will close the alert locally while silently keeping help active.');
  }

  function testSMSParsing() {
    const isMatch = SMSService.isSMSAnSOS(testSMSInput);
    if (isMatch) {
      SMSService.simulateSMS(testSMSInput);
      Alert.alert('SMS Matched', 'SOS pattern detected. Emergency screen will open.');
    } else {
      Alert.alert('No Match', `The SMS format did not match any SOS pattern.\n\nExpected formats:\n- SOS ALERT | LAT:xx.xxxx | LNG:yy.yyyy\n- SOS|xx.xxxx|yy.yyyy`);
    }
  }

  function openPermissions() {
    Linking.openSettings();
  }

  async function playEvidence(uri) {
    if (!uri) return;
    try {
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      sound.setOnPlaybackStatusUpdate(status => { if (status.didJustFinish) sound.unloadAsync(); });
    } catch (error) { Alert.alert('Playback Failed', error.message || 'Could not play this evidence recording.'); }
  }

  function clearEvidenceVault() {
    if (!state.safetyPasskey) {
      Alert.alert('Passkey Required', 'Save your I’m Safe passkey before managing protected evidence.');
      return;
    }
    setDeletePasskey('');
    setDeleteEvidenceVisible(true);
  }

  async function confirmEvidenceDeletion() {
    const isDuress = Boolean(state.duressPasskey && deletePasskey === state.duressPasskey);
    if (!isDuress && deletePasskey !== state.safetyPasskey) {
      Alert.alert('Incorrect Passkey', 'Evidence was not changed.');
      return;
    }
    setDeletingEvidence(true);
    try {
      if (isDuress) {
        await CommunityAlertService.deleteEvidence({ serverUrl: state.alertServerUrl, ownerToken: state.expoPushToken, duress: true }).catch(() => null);
      } else {
        await CommunityAlertService.deleteEvidence({ serverUrl: state.alertServerUrl, ownerToken: state.expoPushToken, duress: false });
      }
      await EvidenceService.clear();
      dispatch({ type: 'SET_EVIDENCE_VAULT', payload: [] });
      setDeleteEvidenceVisible(false);
      Alert.alert('Evidence Vault Cleared', 'All evidence has been removed from this phone.');
    } catch (error) {
      Alert.alert('Deletion Not Completed', `The protected backup could not be deleted, so local evidence was kept. ${error.message || ''}`);
    } finally {
      setDeletingEvidence(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>RESQ 360 CONTROL CENTER</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        <Section title="Language / மொழி / भाषा">
          <View style={[styles.settingRow, styles.settingRowLast]}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Emergency Language</Text>
              <View style={styles.languageRow}>
                {LANGUAGES.map(item => (
                  <TouchableOpacity key={item.code} style={[styles.languageBtn, state.language === item.code && styles.languageBtnActive]}
                    onPress={() => dispatch({ type: 'SET_LANGUAGE', payload: item.code })}>
                    <Text style={[styles.languageText, state.language === item.code && styles.languageTextActive]}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.helperText}>Used for emergency SMS and critical SOS actions.</Text>
            </View>
          </View>
        </Section>

        <Section title="Evidence Vault">
          <View style={[styles.settingRow, styles.settingRowLast]}>
            <View style={[styles.settingIconBg, { backgroundColor: '#ff910022' }]}><Ionicons name="lock-closed" size={16} color="#ff9100" /></View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Consent-based emergency evidence</Text>
              <Text style={styles.helperText}>When enabled, SOS visibly records up to 30 seconds of audio and a location timeline, then backs it up to your configured server.</Text>
              <Text style={styles.settingValue}>{state.evidenceVault.length} evidence session{state.evidenceVault.length === 1 ? '' : 's'} stored</Text>
              {state.evidenceVault.slice(0, 3).map(item => (
                <TouchableOpacity key={item.id} style={styles.evidenceRow} onPress={() => playEvidence(item.audioUri)} disabled={!item.audioUri}>
                  <Ionicons name={item.audioUri ? 'play-circle' : 'location'} size={18} color="#ff9100" />
                  <Text style={styles.evidenceText}>{new Date(item.startedAt).toLocaleString()} · {item.locations?.length || 0} locations · {item.backupStatus === 'backed_up' ? 'Backed up' : item.backupStatus === 'syncing' ? 'Syncing' : 'Local only'}</Text>
                </TouchableOpacity>
              ))}
              {state.evidenceVault.length > 0 && <TouchableOpacity style={styles.clearEvidenceBtn} onPress={clearEvidenceVault}><Text style={styles.clearEvidenceText}>Delete all evidence</Text></TouchableOpacity>}
            </View>
            <Switch value={state.evidenceConsent} onValueChange={value => dispatch({ type: 'SET_EVIDENCE_CONSENT', payload: value })}
              trackColor={{ false: '#333', true: '#ff910077' }} thumbColor={state.evidenceConsent ? '#ff9100' : '#777'} />
          </View>
        </Section>

        <Section title="Your Identity">
          <View style={styles.settingRow}>
            <View style={[styles.settingIconBg, { backgroundColor: '#ff174422' }]}>
              <Ionicons name="person" size={16} color={COLORS.primary} />
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Display Name</Text>
              <TextInput
                style={[styles.inlineInput, { marginTop: 6 }]}
                value={displayNameInput}
                onChangeText={setDisplayNameInput}
                placeholder="e.g., JK"
                placeholderTextColor={COLORS.muted}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
              />
              <Text style={styles.helperText}>
                Shown to others when you trigger an SOS. Leave blank to appear as "Someone".
              </Text>
              <TouchableOpacity style={styles.testBtn} onPress={saveDisplayName}>
                <Ionicons name="save" size={14} color="#fff" />
                <Text style={styles.testBtnText}>Save Name</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Section>

        <Section title="SOS Security">
          <View style={[styles.settingRow, styles.settingRowLast]}>
            <View style={[styles.settingIconBg, { backgroundColor: '#00e67622' }]}>
              <Ionicons name="keypad" size={16} color={COLORS.green} />
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>I’m Safe Passkey</Text>
              <TextInput
                style={[styles.inlineInput, { marginTop: 6 }]}
                value={passkeyInput}
                onChangeText={text => setPasskeyInput(text.replace(/\D/g, '').slice(0, 6))}
                placeholder="4–6 digit passkey"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
              />
              <Text style={styles.helperText}>Required before “I’m Safe” stops your alert on every phone.</Text>
              <TouchableOpacity style={styles.testBtn} onPress={saveSafetyPasskey}>
                <Ionicons name="save" size={14} color="#fff" />
                <Text style={styles.testBtnText}>Save Passkey</Text>
              </TouchableOpacity>
              <Text style={[styles.settingLabel, { marginTop: 16 }]}>Duress Passkey</Text>
              <TextInput style={[styles.inlineInput, { marginTop: 6 }]} value={duressInput}
                onChangeText={text => setDuressInput(text.replace(/\D/g, '').slice(0, 6))}
                placeholder="Different 4–6 digit code" placeholderTextColor={COLORS.muted}
                keyboardType="number-pad" secureTextEntry maxLength={6} />
              <Text style={styles.helperText}>Appears to dismiss SOS locally but does not tell responders you are safe.</Text>
              <TouchableOpacity style={styles.testBtn} onPress={saveDuressPasskey}>
                <Ionicons name="eye-off" size={14} color="#fff" />
                <Text style={styles.testBtnText}>Save Duress Code</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Section>

        <Section title="Community Alerts">
          <SettingRow
            icon="cloud-done"
            iconColor={COLORS.green}
            label="RESQ 360 Cloud"
            value={ALERT_SERVER_URL}
            isLast
          />
        </Section>

        {/* SMS Configuration */}
        <Section title="SMS Backup">
          <SettingRow
            icon="chatbubble"
            iconColor={COLORS.green}
            label="SMS Listener"
            value="Active"
          />

          <View style={[styles.settingRow]}>
            <View style={[styles.settingIconBg, { backgroundColor: COLORS.green + '22' }]}>
              <Ionicons name="call" size={16} color={COLORS.green} />
            </View>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>SIM800L Number</Text>
              {editingSMS ? (
                <View style={styles.inlineEdit}>
                  <TextInput
                    style={styles.inlineInput}
                    value={smsInput}
                    onChangeText={setSmsInput}
                    placeholder="+91 XXXXXXXXXX"
                    placeholderTextColor={COLORS.muted}
                    keyboardType="phone-pad"
                    autoFocus
                  />
                  <TouchableOpacity onPress={saveSMSNumber}>
                    <Ionicons name="checkmark-circle" size={22} color={COLORS.green} />
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.settingValue}>{state.smsNumber || 'Not set'}</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => setEditingSMS(!editingSMS)}>
              <Ionicons name={editingSMS ? 'close' : 'pencil'} size={16} color={COLORS.muted} />
            </TouchableOpacity>
          </View>

          {/* SMS Test */}
          <View style={[styles.settingRow, styles.settingRowLast]}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Test SMS Format</Text>
              <TextInput
                style={[styles.inlineInput, { marginTop: 6 }]}
                value={testSMSInput}
                onChangeText={setTestSMSInput}
                placeholder="Paste SMS here to test..."
                placeholderTextColor={COLORS.muted}
                multiline
              />
              <TouchableOpacity style={styles.testBtn} onPress={testSMSParsing}>
                <Ionicons name="flask" size={14} color="#fff" />
                <Text style={styles.testBtnText}>Test Parse</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Section>

        {/* Permissions */}
        <Section title="Permissions">
          <SettingRow
            icon="location"
            iconColor="#ff9100"
            label="Location"
            value="Required for map & alerts"
            onPress={openPermissions}
          />
          <SettingRow
            icon="chatbubble"
            iconColor={COLORS.green}
            label="Read SMS"
            value="Required for SMS backup"
            onPress={openPermissions}
            isLast
          />
        </Section>

        {/* App Info */}
        <View style={styles.appInfo}>
          <Text style={styles.appInfoText}>RESQ 360 v1.0.1</Text>
          <Text style={styles.appInfoText}>Personal Emergency Response</Text>
          <Text style={styles.appInfoSubtext}>App-only Mode - No Hardware Required</Text>
        </View>

      </ScrollView>
      <Modal visible={deleteEvidenceVisible} transparent animationType="fade" onRequestClose={() => !deletingEvidence && setDeleteEvidenceVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.deleteCard}>
            <Ionicons name="shield-checkmark" size={32} color="#ff9100" />
            <Text style={styles.deleteTitle}>Unlock Evidence Deletion</Text>
            <Text style={styles.deleteHelp}>Enter your saved passkey to delete the vault. Your duress passkey makes the vault appear empty while retaining its protected server copy.</Text>
            <TextInput style={styles.deleteInput} value={deletePasskey}
              onChangeText={text => setDeletePasskey(text.replace(/\D/g, '').slice(0, 6))}
              placeholder="4–6 digit passkey" placeholderTextColor={COLORS.muted}
              keyboardType="number-pad" secureTextEntry maxLength={6} autoFocus />
            <View style={styles.deleteActions}>
              <TouchableOpacity style={styles.cancelDeleteBtn} disabled={deletingEvidence} onPress={() => setDeleteEvidenceVisible(false)}><Text style={styles.cancelDeleteText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.confirmDeleteBtn} disabled={deletingEvidence} onPress={confirmEvidenceDeletion}><Text style={styles.confirmDeleteText}>{deletingEvidence ? 'Checking…' : 'Delete vault'}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  scroll: { padding: 16, paddingBottom: 40 },

  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    color: COLORS.muted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingRowLast: { borderBottomWidth: 0 },
  settingIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingInfo: { flex: 1 },
  settingLabel: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  settingValue: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  helperText: { fontSize: 11, color: COLORS.muted, marginTop: 6, lineHeight: 15 },

  inlineEdit: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  inlineInput: {
    flex: 1,
    backgroundColor: COLORS.input,
    borderRadius: 8,
    padding: 8,
    color: COLORS.text,
    fontSize: 13,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ff174422',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#ff174444',
  },
  testBtnText: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },
  languageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  languageBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.input },
  languageBtnActive: { borderColor: COLORS.primary, backgroundColor: '#ff174422' },
  languageText: { color: COLORS.muted, fontSize: 12, fontWeight: '600' },
  languageTextActive: { color: COLORS.primary },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 8, borderRadius: 8, backgroundColor: '#ff910011' },
  evidenceText: { color: COLORS.muted, fontSize: 11, flex: 1 },
  clearEvidenceBtn: { marginTop: 12, alignSelf: 'flex-start', paddingVertical: 8 },
  clearEvidenceText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', padding: 24 },
  deleteCard: { backgroundColor: '#151515', borderRadius: 20, borderWidth: 1, borderColor: '#ff910055', padding: 24, alignItems: 'center' },
  deleteTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800', marginTop: 12 },
  deleteHelp: { color: '#aaa', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  deleteInput: { width: '100%', backgroundColor: COLORS.input, borderRadius: 12, borderWidth: 1, borderColor: '#444', color: COLORS.text, fontSize: 22, letterSpacing: 8, textAlign: 'center', padding: 14, marginTop: 20 },
  deleteActions: { width: '100%', flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelDeleteBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#444' },
  cancelDeleteText: { color: COLORS.text, fontWeight: '700' },
  confirmDeleteBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: COLORS.primary },
  confirmDeleteText: { color: '#fff', fontWeight: '800' },

  appInfo: { alignItems: 'center', paddingTop: 8, gap: 4 },
  appInfoText: { fontSize: 13, color: COLORS.muted },
  appInfoSubtext: { fontSize: 11, color: '#444' },
});
