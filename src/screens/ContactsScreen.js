import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppContext } from '../store/AppContext';

const COLORS = {
  bg: '#06131F',
  card: '#0C2233',
  border: '#1C4057',
  primary: '#00C2A8',
  text: '#ffffff',
  muted: '#91A9B8',
  input: '#1a1a1a',
};

function generateId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

export default function ContactsScreen() {
  const { state, dispatch } = useAppContext();
  const [modalVisible, setModalVisible] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');

  function openAddModal() {
    setEditContact(null);
    setName('');
    setPhone('');
    setRelation('');
    setModalVisible(true);
  }

  function openEditModal(contact) {
    setEditContact(contact);
    setName(contact.name);
    setPhone(contact.phone);
    setRelation(contact.relation || '');
    setModalVisible(true);
  }

  function saveContact() {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Missing Info', 'Name and phone number are required.');
      return;
    }

    if (editContact) {
      dispatch({
        type: 'UPDATE_CONTACT',
        payload: { ...editContact, name: name.trim(), phone: phone.trim(), relation: relation.trim() },
      });
    } else {
      dispatch({
        type: 'ADD_CONTACT',
        payload: { id: generateId(), name: name.trim(), phone: phone.trim(), relation: relation.trim() },
      });
    }
    setModalVisible(false);
  }

  function deleteContact(id) {
    Alert.alert('Delete Contact', 'Remove this emergency contact?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => dispatch({ type: 'DELETE_CONTACT', payload: id }),
      },
    ]);
  }

  function callContact(phone) {
    Linking.openURL(`tel:${phone}`);
  }

  function renderContact({ item, index }) {
    const colors = ['#00C2A8', '#FFB020', '#36D399', '#4D9FFF', '#9B8AFB'];
    const color = colors[index % colors.length];
    const initials = item.name
      .split(' ')
      .map(w => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    return (
      <View style={styles.contactCard}>
        <View style={[styles.avatar, { backgroundColor: color + '22', borderColor: color + '55' }]}>
          <Text style={[styles.avatarText, { color }]}>{initials}</Text>
        </View>

        <View style={styles.contactInfo}>
          <Text style={styles.contactName}>{item.name}</Text>
          <Text style={styles.contactPhone}>{item.phone}</Text>
          {item.relation ? <Text style={styles.contactRelation}>{item.relation}</Text> : null}
        </View>

        <View style={styles.contactActions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => callContact(item.phone)}>
            <Ionicons name="call" size={18} color="#00e676" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => openEditModal(item)}>
            <Ionicons name="pencil" size={16} color={COLORS.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => deleteContact(item.id)}>
            <Ionicons name="trash" size={16} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Emergency Contacts</Text>
          <Text style={styles.subtitle}>{state.contacts.length} contact{state.contacts.length !== 1 ? 's' : ''} saved</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAddModal}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {state.contacts.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={56} color={COLORS.border} />
          <Text style={styles.emptyTitle}>No Contacts Yet</Text>
          <Text style={styles.emptySubtitle}>
            Add emergency contacts who will be called when SOS is triggered
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={openAddModal}>
            <Ionicons name="add-circle" size={18} color="#fff" />
            <Text style={styles.emptyBtnText}>Add First Contact</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={state.contacts}
          keyExtractor={item => item.id}
          renderItem={renderContact}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Add/Edit Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editContact ? 'Edit Contact' : 'Add Contact'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.muted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Full Name *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g., Mom"
              placeholderTextColor={COLORS.muted}
              autoFocus
            />

            <Text style={styles.inputLabel}>Phone Number *</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 9876543210"
              placeholderTextColor={COLORS.muted}
              keyboardType="phone-pad"
            />

            <Text style={styles.inputLabel}>Relation (optional)</Text>
            <TextInput
              style={styles.input}
              value={relation}
              onChangeText={setRelation}
              placeholder="e.g., Mother, Sister, Friend"
              placeholderTextColor={COLORS.muted}
            />

            <TouchableOpacity style={styles.saveBtn} onPress={saveContact}>
              <Text style={styles.saveBtnText}>{editContact ? 'Update Contact' : 'Save Contact'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '800' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  contactPhone: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  contactRelation: { fontSize: 11, color: '#555', marginTop: 2, fontStyle: 'italic' },
  contactActions: { flexDirection: 'row', gap: 4 },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff08',
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  emptySubtitle: { fontSize: 13, color: COLORS.muted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 30,
    marginTop: 8,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#00000088',
  },
  modalContent: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  inputLabel: { fontSize: 11, color: COLORS.muted, letterSpacing: 1, textTransform: 'uppercase' },
  input: {
    backgroundColor: COLORS.input,
    borderRadius: 10,
    padding: 14,
    color: COLORS.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
