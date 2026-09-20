import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { CommunityAlertService } from '../services/CommunityAlertService';
import { useAppContext } from '../store/AppContext';

const TYPES = ['FIRE', 'ACCIDENT', 'FLOOD', 'LANDSLIDE', 'MEDICAL', 'BUILDING_COLLAPSE', 'MISSING_PERSON', 'OTHER'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function PublicEmergencyScreen({ navigation }) {
  const { state } = useAppContext();
  const [incidentType, setIncidentType] = useState('LANDSLIDE');
  const [severity, setSeverity] = useState('HIGH');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [reported, setReported] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [demoReportCount, setDemoReportCount] = useState(0);

  async function report() {
    setLoading(true);
    try {
      let latitude, longitude;
      if (demoMode) {
        latitude = 11.0168 + (demoReportCount % 3) * 0.0015;
        longitude = 76.9558 + (demoReportCount % 3) * 0.0012;
      } else {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') throw new Error('Location permission is required to report a public emergency.');
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        latitude = location.coords.latitude; longitude = location.coords.longitude;
      }
      const result = await CommunityAlertService.reportPublicIncident({ serverUrl: state.alertServerUrl,
        incidentType, severity, description: description.trim(), latitude, longitude, demoMode });
      setReported(result.incidentId);
      if (demoMode && !result.duplicate) setDemoReportCount(count => count + 1);
    } catch (error) {
      Alert.alert('Report Not Sent', error.message || 'Check your connection and try again.');
    } finally { setLoading(false); }
  }

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}><Text style={styles.backText}>‹ Back</Text></TouchableOpacity>
    <Text style={styles.title}>Public emergency report</Text>
    <Text style={styles.hint}>Separate from personal SOS. A report does not dispatch any agency.</Text>
    {reported ? <View style={styles.card}><Text style={styles.success}>Report recorded</Text><Text style={styles.text}>Reference: {reported}</Text><Text style={styles.hint}>An authorized authority can review the situation and nearby registered demo resources.</Text><TouchableOpacity style={styles.button} onPress={() => { setReported(null); setDescription(''); }}><Text style={styles.buttonText}>REPORT ANOTHER OBSERVATION</Text></TouchableOpacity></View> : <>
      <Text style={styles.label}>INCIDENT TYPE</Text><View style={styles.choices}>{TYPES.map(item => <TouchableOpacity key={item} style={[styles.chip, incidentType === item && styles.selected]} onPress={() => setIncidentType(item)}><Text style={styles.chipText}>{item.replace(/_/g, ' ')}</Text></TouchableOpacity>)}</View>
      <Text style={styles.label}>SEVERITY</Text><View style={styles.choices}>{SEVERITIES.map(item => <TouchableOpacity key={item} style={[styles.chip, severity === item && styles.selected]} onPress={() => setSeverity(item)}><Text style={styles.chipText}>{item}</Text></TouchableOpacity>)}</View>
      <Text style={styles.label}>WHAT HAPPENED?</Text><TextInput style={styles.input} multiline maxLength={500} placeholder="Describe the situation" placeholderTextColor="#78909C" value={description} onChangeText={setDescription} />
      <TouchableOpacity style={styles.chip} onPress={() => setDemoMode(value => !value)}><Text style={styles.chipText}>{demoMode ? '✓ ' : '○ '}Use Coimbatore demo location (11.0168, 76.9558)</Text></TouchableOpacity>
      <Text style={styles.hint}>{demoMode ? 'SIMULATION: test coordinates will be used, not your current GPS.' : 'Your current GPS will be captured when you submit.'}</Text>
      <TouchableOpacity style={styles.button} onPress={report} disabled={loading} accessibilityRole="button"><Text style={styles.buttonText}>{loading ? 'REPORTING…' : 'REPORT PUBLIC EMERGENCY'}</Text>{loading && <ActivityIndicator color="#fff" />}</TouchableOpacity>
    </>}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ page:{flex:1,backgroundColor:'#06131F'}, content:{padding:16,paddingBottom:40}, back:{minHeight:44,justifyContent:'center'},backText:{color:'#91A9B8',fontSize:16},title:{color:'#fff',fontSize:22,fontWeight:'800',marginTop:8},hint:{color:'#91A9B8',fontSize:13,lineHeight:19,marginTop:8},label:{color:'#91A9B8',fontSize:11,fontWeight:'700',letterSpacing:1,marginTop:24,marginBottom:8},choices:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{borderWidth:1,borderColor:'#1C4057',borderRadius:10,paddingHorizontal:12,minHeight:44,justifyContent:'center',backgroundColor:'#0C2233'},selected:{borderColor:'#00C2A8',backgroundColor:'#12645D'},chipText:{color:'#fff',fontSize:12,fontWeight:'700'},input:{backgroundColor:'#0C2233',borderWidth:1,borderColor:'#1C4057',borderRadius:10,color:'#fff',padding:12,minHeight:96,textAlignVertical:'top'},button:{backgroundColor:'#D32F2F',borderRadius:10,minHeight:52,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,marginTop:24},buttonText:{color:'#fff',fontWeight:'800',fontSize:13},card:{backgroundColor:'#0C2233',borderColor:'#1C4057',borderWidth:1,borderRadius:12,padding:16,marginTop:24},success:{color:'#36D399',fontSize:18,fontWeight:'800'},text:{color:'#fff',fontSize:12,marginTop:8} });
