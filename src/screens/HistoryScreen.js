import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppContext } from '../store/AppContext';
import { normalizeDisplayName } from '../utils/displayName';

const COLORS = {
  bg: '#06131F',
  card: '#0C2233',
  border: '#1C4057',
  primary: '#00C2A8',
  text: '#ffffff',
  muted: '#91A9B8',
  green: '#00e676',
  orange: '#ff9100',
  blue: '#448aff',
};

function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function getSourceIcon(item) {
  if (item.remoteBroadcast) return 'people';
  return {
    SMS: 'chatbubble',
    MANUAL: 'hand-left',
  }[item.source] || 'alert-circle';
}

function getSourceColor(item) {
  if (item.remoteBroadcast) return COLORS.blue;
  return {
    SMS: COLORS.green,
    MANUAL: COLORS.orange,
  }[item.source] || COLORS.primary;
}

function getSourceLabel(item) {
  if (item.remoteBroadcast) {
    return `${normalizeDisplayName(item.senderName)} triggered an SOS`;
  }
  return `${item.source} TRIGGER`;
}

export default function HistoryScreen() {
  const { state, dispatch } = useAppContext();

  function clearHistory() {
    Alert.alert('Clear History', 'Delete all emergency event history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: () => dispatch({ type: 'CLEAR_HISTORY' }),
      },
    ]);
  }

  function openMap(lat, lng) {
    if (lat === undefined || lat === null || lng === undefined || lng === null) return;
    Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}(SOS Location)`);
  }

  function renderEvent({ item, index }) {
    const sourceColor = getSourceColor(item);
    const sourceIcon = getSourceIcon(item);
    const sourceLabel = getSourceLabel(item);
    const hasLocation = item.lat !== undefined && item.lat !== null && item.lng !== undefined && item.lng !== null;

    return (
      <View style={styles.eventCard}>
        <View style={styles.eventLeft}>
          <View style={[styles.sourceIcon, { backgroundColor: sourceColor + '22', borderColor: sourceColor + '44' }]}>
            <Ionicons name={sourceIcon} size={18} color={sourceColor} />
          </View>
          <View style={styles.eventLine} />
        </View>

        <View style={styles.eventBody}>
          <View style={styles.eventHeader}>
            <Text style={[styles.sourceLabel, { color: sourceColor }]}>
              {sourceLabel}
            </Text>
            <Text style={styles.eventIndex}>#{state.historyEvents.length - index}</Text>
          </View>

          <Text style={styles.eventTime}>{formatDate(item.timestamp)}</Text>

          {hasLocation ? (
            <TouchableOpacity
              style={styles.locationRow}
              onPress={() => openMap(item.lat, item.lng)}
            >
              <Ionicons name="location" size={12} color={COLORS.muted} />
              <Text style={styles.locationText}>
                {parseFloat(item.lat).toFixed(5)}, {parseFloat(item.lng).toFixed(5)}
              </Text>
              <Ionicons name="open-outline" size={11} color={COLORS.muted} />
            </TouchableOpacity>
          ) : (
            <Text style={styles.noLocation}>No location data</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Alert History</Text>
          <Text style={styles.subtitle}>
            {state.historyEvents.length} event{state.historyEvents.length !== 1 ? 's' : ''} recorded
          </Text>
        </View>
        {state.historyEvents.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={clearHistory}>
            <Ionicons name="trash-outline" size={16} color={COLORS.muted} />
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {[
          { label: 'SMS Alert', color: COLORS.green },
          { label: 'Manual', color: COLORS.orange },
          { label: 'Community', color: COLORS.blue },
        ].map(({ label, color }) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>

      {state.historyEvents.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="shield-checkmark-outline" size={56} color={COLORS.border} />
          <Text style={styles.emptyTitle}>No Alerts Yet</Text>
          <Text style={styles.emptySubtitle}>Emergency events will appear here when triggered</Text>
        </View>
      ) : (
        <FlatList
          data={state.historyEvents}
          keyExtractor={(item, index) => `${item.timestamp}-${index}`}
          renderItem={renderEvent}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        />
      )}
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
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
  },
  clearText: { fontSize: 13, color: COLORS.muted },

  legend: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 11, color: COLORS.muted },

  eventCard: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  eventLeft: { alignItems: 'center', width: 40 },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventLine: {
    flex: 1,
    width: 1,
    backgroundColor: COLORS.border,
    marginTop: 4,
    marginBottom: -4,
  },

  eventBody: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
    gap: 4,
  },
  eventHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sourceLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  eventIndex: { fontSize: 11, color: COLORS.muted },
  eventTime: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  locationText: { fontSize: 11, color: COLORS.muted, fontFamily: 'monospace', flex: 1 },
  noLocation: { fontSize: 11, color: '#444', fontStyle: 'italic' },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  emptySubtitle: { fontSize: 13, color: COLORS.muted, textAlign: 'center', lineHeight: 20 },
});
