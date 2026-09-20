# ⚠️  SECURITY WARNING — google-services.json

This file contains your Firebase **API key** and **project credentials** in plain text.

## What is exposed
- `project_number`: 308363321025
- `project_id`: guardian-angel-f5a88
- `mobilesdk_app_id`: (unique app identifier)
- `current_key`: AIzaSyC8WS... (Firebase API key)

## Required actions

### 1. Add to .gitignore immediately
```
# Firebase / Google Services — contains API keys
google-services.json
GoogleService-Info.plist
```

### 2. If this file was ever committed to a public or shared repo
1. Go to https://console.firebase.google.com/project/guardian-angel-f5a88
2. Project Settings -> General -> Your apps
3. Regenerate the API key, or restrict it:
   - Go to https://console.cloud.google.com/apis/credentials
   - Select the key -> Add Android app restriction -> limit to package `com.safeguard.app`

### 3. Use EAS Secrets for CI/CD
```bash
# Store the file as a secret in EAS instead of committing it
eas secret:create --scope project --name GOOGLE_SERVICES_JSON \
  --type file --value ./google-services.json
```

Then in `eas.json`, reference it:
```json
{
  "build": {
    "production": {
      "android": {
        "googleServicesFile": "$GOOGLE_SERVICES_JSON"
      }
    }
  }
}
```

The file itself is fine to keep locally — just never commit it.
