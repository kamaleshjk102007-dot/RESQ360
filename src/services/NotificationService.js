import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

class NotificationServiceClass {
  foregroundSubscription = null;
  responseSubscription = null;

  async initialize() {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[Notifications] Permission not granted');
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('resq-community-emergency-v2', {
        name: 'RESQ 360 Emergency Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500, 200, 800],
        lightColor: '#FF1744',
        sound: 'default',
        enableLights: true,
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
      await Notifications.setNotificationChannelAsync('emergency', {
        name: 'Emergency Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500, 200, 500],
        lightColor: '#FF1744',
        sound: 'default',
        enableLights: true,
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
    }
  }

  subscribe(onAlert) {
    this.unsubscribe();

    this.foregroundSubscription = Notifications.addNotificationReceivedListener((notification) => {
      onAlert?.(notification.request.content.data || {});
    });

    this.responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      onAlert?.(response.notification.request.content.data || {});
    });
  }

  async getLastResponseData() {
    const response = await Notifications.getLastNotificationResponseAsync();
    return response?.notification?.request?.content?.data || null;
  }

  unsubscribe() {
    this.foregroundSubscription?.remove?.();
    this.responseSubscription?.remove?.();
    this.foregroundSubscription = null;
    this.responseSubscription = null;
  }

  async sendEmergencyNotification(data) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'SOS EMERGENCY ALERT',
        body: `Emergency detected!\nLat: ${data.lat?.toFixed(5)}, Lng: ${data.lng?.toFixed(5)}`,
        data: {
          lat: data.lat,
          lng: data.lng,
          source: data.source || 'LOCAL',
          timestamp: data.timestamp || new Date().toISOString(),
          remoteBroadcast: !!data.remoteBroadcast,
        },
        sound: 'default',
        priority: 'max',
        color: '#FF1744',
        vibrate: [0, 500, 200, 500],
      },
      trigger: null,
      ...(Platform.OS === 'android' && { channelId: 'emergency' }),
    });
  }
}

export const NotificationService = new NotificationServiceClass();
