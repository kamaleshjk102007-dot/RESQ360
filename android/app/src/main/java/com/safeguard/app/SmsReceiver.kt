package com.safeguard.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.core.DeviceEventManagerModule

class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    if (messages.isNullOrEmpty()) return

    val body = messages.joinToString(separator = "") { it.messageBody ?: "" }
    val sender = messages.firstOrNull()?.originatingAddress ?: ""
    if (body.isBlank()) return

    savePendingSms(context, body, sender)

    val application = context.applicationContext as? ReactApplication ?: return
    val reactContext = application.reactNativeHost
      .reactInstanceManager
      .currentReactContext ?: return

    emitSms(reactContext, body, sender)
    clearPendingSms(context)
  }

  private fun savePendingSms(context: Context, body: String, sender: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_BODY, body)
      .putString(KEY_SENDER, sender)
      .putLong(KEY_TIMESTAMP, System.currentTimeMillis())
      .apply()
  }

  private fun clearPendingSms(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .apply()
  }

  private fun emitSms(reactContext: ReactContext, body: String, sender: String) {
    val params = Arguments.createMap().apply {
      putString("body", body)
      putString("message", body)
      putString("sender", sender)
      putDouble("timestamp", System.currentTimeMillis().toDouble())
    }

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("onSmsReceived", params)
  }

  companion object {
    const val PREFS_NAME = "safeguard_sms"
    const val KEY_BODY = "pending_body"
    const val KEY_SENDER = "pending_sender"
    const val KEY_TIMESTAMP = "pending_timestamp"
  }
}
