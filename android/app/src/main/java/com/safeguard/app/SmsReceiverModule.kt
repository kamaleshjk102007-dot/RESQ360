package com.safeguard.app

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class SmsReceiverModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ReceiveSms"

  @ReactMethod
  fun enableReceiver() {
    emitPendingSms()
  }

  @ReactMethod
  fun disableReceiver() {
    // No-op; Android controls manifest receiver delivery.
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by NativeEventEmitter.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required by NativeEventEmitter.
  }

  private fun emitPendingSms() {
    val prefs = reactApplicationContext.getSharedPreferences(
      SmsReceiver.PREFS_NAME,
      Context.MODE_PRIVATE
    )
    val body = prefs.getString(SmsReceiver.KEY_BODY, null) ?: return
    val sender = prefs.getString(SmsReceiver.KEY_SENDER, "") ?: ""
    val timestamp = prefs.getLong(SmsReceiver.KEY_TIMESTAMP, System.currentTimeMillis())

    prefs.edit().clear().apply()

    val params = Arguments.createMap().apply {
      putString("body", body)
      putString("message", body)
      putString("sender", sender)
      putDouble("timestamp", timestamp.toDouble())
    }

    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onSmsReceived", params)
  }
}
