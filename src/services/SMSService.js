import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// SMS Format from SIM800L:
// "SOS ALERT | LAT:xx.xxxx | LNG:yy.yyyy"
// Also supports: "SOS|12.9716|77.5946" compact format

const SMS_PATTERNS = [
  // Full format: "SOS ALERT | LAT:12.9716 | LNG:77.5946"
  /SOS\s+ALERT\s*\|\s*LAT:([-\d.]+)\s*\|\s*LNG:([-\d.]+)/i,
  // Compact format: "SOS|12.9716|77.5946"
  /SOS\|([-\d.]+)\|([-\d.]+)/i,
  // Alternative: "EMERGENCY LAT=12.9716 LNG=77.5946"
  /EMERGENCY\s+LAT=([-\d.]+)\s+LNG=([-\d.]+)/i,
  // Generic GPS format with SOS keyword
  /SOS.*?([-\d]{1,3}\.[-\d]{4,})[,\s]+([-\d]{1,3}\.[-\d]{4,})/i,
];

class SMSServiceClass {
  constructor() {
    this.onSOSCallback = null;
    this.eventSubscription = null;
    this.isListening = false;
    this.registeredNumbers = []; // Optional: filter by SIM800L number
  }

  startListening(onSOSCallback) {
    if (this.isListening) return;
    this.onSOSCallback = onSOSCallback;
    this.isListening = true;

    if (Platform.OS !== 'android') {
      console.log('[SMS] SMS listening only available on Android');
      return;
    }

    try {
      this._initBroadcastReceiver();
    } catch (err) {
      console.error('[SMS] Failed to start SMS listener:', err);
    }
  }

  _initBroadcastReceiver() {
    try {
      const { ReceiveSms } = NativeModules;
      if (!ReceiveSms) {
        console.log('[SMS] No SMS receiver module found. Using polling fallback.');
        this._startPollingFallback();
        return;
      }

      const emitter = new NativeEventEmitter(ReceiveSms);
      this.eventSubscription = emitter.addListener('onSmsReceived', (sms) => {
        console.log('[SMS] Broadcast received:', sms);
        this._processSMS(sms.body || sms.message || '');
      });

      ReceiveSms.enableReceiver();
      console.log('[SMS] Broadcast receiver enabled');
    } catch (err) {
      console.error('[SMS] Broadcast receiver error:', err);
    }
  }

  _startPollingFallback() {
    // Fallback: read SMS from content provider periodically
    // This requires READ_SMS permission
    console.log('[SMS] Starting polling fallback (requires READ_SMS permission)');

    const { RNSmsRetriever } = NativeModules;
    if (!RNSmsRetriever) return;

    this._lastSmsId = null;

    this._pollInterval = setInterval(async () => {
      try {
        const smsList = await RNSmsRetriever.getLastSms(5);
        if (smsList && smsList.length > 0) {
          for (const sms of smsList) {
            if (sms.id !== this._lastSmsId) {
              this._lastSmsId = sms.id;
              this._processSMS(sms.body);
            }
          }
        }
      } catch (e) {}
    }, 3000);
  }

  _processSMS(body) {
    if (!body) return;
    console.log('[SMS] Processing:', body);

    for (const pattern of SMS_PATTERNS) {
      const match = body.match(pattern);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);

        if (isNaN(lat) || isNaN(lng)) continue;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

        console.log('[SMS] SOS Parsed! Lat:', lat, 'Lng:', lng);

        this.onSOSCallback?.({
          lat,
          lng,
          rawSMS: body,
          event: 'SOS',
        });
        return;
      }
    }

    console.log('[SMS] No SOS pattern matched in:', body);
  }

  // For testing: manually trigger an SMS parse
  simulateSMS(body) {
    this._processSMS(body);
  }

  // Check if a given SMS matches SOS format
  isSMSAnSOS(body) {
    return SMS_PATTERNS.some(p => p.test(body));
  }

  stopListening() {
    this.isListening = false;
    if (this.eventSubscription) {
      this.eventSubscription.remove();
      this.eventSubscription = null;
    }
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
    }
  }
}

export const SMSService = new SMSServiceClass();
