import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from '../screens/HomeScreen';
import EmergencyScreen from '../screens/EmergencyScreen';
import CommunityAlertScreen from '../screens/CommunityAlertScreen';
import MapScreen from '../screens/MapScreen';
import ContactsScreen from '../screens/ContactsScreen';
import HistoryScreen from '../screens/HistoryScreen';
import SettingsScreen from '../screens/SettingsScreen';
import PublicEmergencyScreen from '../screens/PublicEmergencyScreen';
import AuthorityResourcesScreen from '../screens/AuthorityResourcesScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

const COLORS = {
  bg: '#06131F',
  card: '#141414',
  border: '#1C4057',
  primary: '#00C2A8',
  text: '#ffffff',
  muted: '#78909C',
  active: '#00C2A8',
};

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.card,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 65,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: COLORS.active,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.5,
        },
        tabBarIcon: ({ focused, color, size }) => {
          const icons = {
            Home: focused ? 'shield' : 'shield-outline',
            Map: focused ? 'map' : 'map-outline',
            Contacts: focused ? 'people' : 'people-outline',
            History: focused ? 'time' : 'time-outline',
            Settings: focused ? 'settings' : 'settings-outline',
          };
          return <Ionicons name={icons[route.name]} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Contacts" component={ContactsScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={TabNavigator} />
      <Stack.Screen name="PublicEmergency" component={PublicEmergencyScreen} />
      <Stack.Screen name="AuthorityResources" component={AuthorityResourcesScreen} />

      {/* Local SOS only — the sender's own emergency. Never opened for a remote alert. */}
      <Stack.Screen
        name="Emergency"
        component={EmergencyScreen}
        options={{
          presentation: 'fullScreenModal',
          gestureEnabled: false,
          animationTypeForReplace: 'push',
        }}
      />

      {/* Remote / community alerts — informational, dismissible, never touches local SOS state. */}
      <Stack.Screen
        name="CommunityAlert"
        component={CommunityAlertScreen}
        options={{
          presentation: 'modal',
          gestureEnabled: true,
        }}
      />
    </Stack.Navigator>
  );
}
