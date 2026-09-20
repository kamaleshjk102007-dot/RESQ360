# SafeGuard — Bug Report & Fix Summary

All bugs found across the uploaded project files, ordered by severity.

---

## 🔴 CRITICAL — Will break the build entirely

### BUG-01 · Wrong babel config filename
| Field | Value |
|-------|-------|
| File | `babel_config.js` |
| Fix | Rename to `babel.config.js` |
| Impact | **App will not build at all.** Expo/Metro bundler only looks for `babel.config.js` or `.babelrc`. With the wrong name the file is silently ignored, all `@screens`, `@services`, `@store` path aliases break with "module not found" errors, and `react-native-reanimated` fails to register its plugin. |

```bash
# Fix command (run in your SafeGuard/ root)
mv babel_config.js babel.config.js
```

### BUG-02 · `react-native-reanimated/plugin` must be LAST in babel plugins
| Field | Value |
|-------|-------|
| File | `babel.config.js` (after rename) |
| Fix | Move `'react-native-reanimated/plugin'` to the end of the plugins array |
| Impact | Causes runtime crash on animated components on certain RN/Reanimated version combos |

```js
// ❌ Wrong order
plugins: [
  'react-native-reanimated/plugin',   // first
  ['module-resolver', { ... }],
]

// ✅ Correct order
plugins: [
  ['module-resolver', { ... }],
  'react-native-reanimated/plugin',   // LAST
]
```

---

## 🔴 CRITICAL — Security vulnerability

### BUG-03 · Firebase API key committed to source code
| Field | Value |
|-------|-------|
| File | `google-services.json` |
| Fix | Add file to `.gitignore`; use EAS Secrets for CI |
| Impact | If pushed to any public or shared repo, the Firebase project is fully exposed. Attackers can abuse the API key for storage reads/writes, crash your app, or incur Firebase costs. |

**Immediate fix:**
```bash
echo "google-services.json" >> .gitignore
echo "GoogleService-Info.plist" >> .gitignore
```
See `SECURITY_WARNING.md` for full remediation steps.

---

## 🟠 HIGH — Runtime bugs

### BUG-04 · Stale closure: `broadcastCommunityAlert` captures `alertServerUrl` at mount time
| Field | Value |
|-------|-------|
| File | `App.js` |
| Fix | Move function into `useCallback`, expose via `useRef` to BLE/SMS callbacks |
| Impact | If the user sets `alertServerUrl` after app launch (e.g., in Settings), the BLE and SMS callbacks will still broadcast to `undefined` (the initial value). Alerts silently fail. |

```js
// ❌ Bug: serverUrl captured once at mount, never updates
const broadcastCommunityAlert = async (payload) => {
  if (!state.alertServerUrl) return;   // stale after mount
  ...
};

// ✅ Fix: use ref pattern
const broadcastRef = useRef(broadcastCommunityAlert);
useEffect(() => { broadcastRef.current = broadcastCommunityAlert; }, [broadcastCommunityAlert]);
// Then inside BLE/SMS callbacks: broadcastRef.current({ ... })
```

### BUG-05 · `NotificationService.subscribe` called with unstable function reference
| Field | Value |
|-------|-------|
| File | `App.js` |
| Fix | Wrap `handleIncomingCommunityAlert` in `useCallback` |
| Impact | Every render replaces the subscriber with a new function object. If `NotificationService` internally de-dupes by reference or has a subscription list, this causes duplicate subscriptions or missed alerts. |

### BUG-06 · Missing optional chaining on `navigationRef.current`
| Field | Value |
|-------|-------|
| File | `App.js` |
| Fix | Change `.navigate(` to `?.navigate(` in all 3 call sites |
| Impact | If a notification or BLE event fires during app startup before the navigator is mounted, the app crashes with `TypeError: Cannot read property 'navigate' of null` |

```js
// ❌ Crashes if nav not mounted yet
navigationRef.current.navigate('Emergency');

// ✅ Safe
navigationRef.current?.navigate('Emergency');
```

---

## 🟡 MEDIUM — Incorrect configuration

### BUG-07 · `owner` field in `app.json` is a phone number, not an Expo username
| Field | Value |
|-------|-------|
| File | `app.json` |
| Current value | `"714024106034"` |
| Fix | Replace with your actual Expo account username |
| Impact | `eas build` will fail authentication. EAS links builds to the wrong account. |

```json
// ❌
"owner": "714024106034"

// ✅
"owner": "your_actual_expo_username"
```
Find your username at https://expo.dev/accounts

### BUG-08 · Missing `expo-device` dependency
| Field | Value |
|-------|-------|
| File | `package.json` |
| Fix | Add `"expo-device": "~5.9.4"` to dependencies |
| Impact | `expo-notifications` requires `expo-device` to check `Device.isDevice` before registering for push tokens. Without it, `CommunityAlertService.registerForPushAsync()` will crash on physical devices with a missing module error. |

```bash
npx expo install expo-device
```

### BUG-09 · `expo-constants` used but not declared in `package.json`
| Field | Value |
|-------|-------|
| File | `package.json` |
| Fix | Add `"expo-constants": "~15.4.6"` to dependencies |
| Impact | It's installed transitively (present in `package-lock.json`) but transitive dependencies are not guaranteed to stay at the required version. Will break unpredictably on fresh installs. |

```bash
npx expo install expo-constants
```

### BUG-10 · `react-native-sms-retriever` removed (conflicting with custom SMS receiver)
| Field | Value |
|-------|-------|
| File | `package.json` |
| Fix | Remove this package |
| Impact | The app already registers a native `SmsReceiver` (`SMSService`) and uses a custom `BroadcastReceiver` in `AndroidManifest.xml`. `react-native-sms-retriever` uses the SMS User Consent API which conflicts — both will try to handle the same SMS broadcast, causing duplicate triggers or the custom receiver being overridden. |

---

## 🔵 LOW — Code quality warnings

### BUG-11 · `Alert` imported but never used in `App.js`
```js
// ❌ Remove this unused import
import { StatusBar, AppState, Alert, LogBox } from 'react-native';

// ✅
import { StatusBar, AppState, LogBox } from 'react-native';
```

### BUG-12 · `useEffect` dependency arrays incomplete (ESLint `react-hooks/exhaustive-deps`)
The second `useEffect` that calls `registerCurrentDevice` depends on
`state.bleDeviceName`, `state.deviceName`, and `dispatch` but only lists
`state.alertServerUrl`. Fix: add all values used inside the effect to the
deps array (see fixed `App.js`).

### BUG-13 · `react-native-vector-icons` needs manual post-prebuild linking
After running `npx expo prebuild`, add to `android/app/build.gradle`:
```gradle
apply from: "../../node_modules/react-native-vector-icons/fonts.gradle"
```
Without this, all icon fonts render as empty squares at runtime.

---

## 📋 Fixed Files Provided

| File | Changes |
|------|---------|
| `babel.config.js` | Renamed from `babel_config.js`; plugin order fixed |
| `App.js` | BUG-04, 05, 06, 11, 12 fixed |
| `app.json` | BUG-07 owner field placeholder corrected |
| `package.json` | BUG-08 expo-device added; BUG-09 expo-constants added; BUG-10 sms-retriever removed |
| `SECURITY_WARNING.md` | BUG-03 remediation steps |

---

## ✅ Files That Are Correct

| File | Status |
|------|--------|
| `index.js` | No issues |
| `eas.json` | No issues |
| `google-services.json` | Config is correct; security issue is about storage, not content |
| Package name match between `app.json` and `google-services.json` | ✅ Both `com.safeguard.app` |
