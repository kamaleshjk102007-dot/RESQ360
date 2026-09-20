package com.safeguard.app

import android.Manifest
import android.content.pm.PackageManager
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

class EmergencySmsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "EmergencySms"

  @ReactMethod
  fun sendToAll(rawNumbers: ReadableArray, message: String, promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("SMS_PERMISSION", "SMS permission is not granted")
      return
    }
    val numbers = (0 until rawNumbers.size()).mapNotNull { rawNumbers.getString(it) }
      .map { it.filter { ch -> ch.isDigit() || ch == '+' } }.filter { it.isNotBlank() }.distinct()
    try {
      val manager = SmsManager.getDefault()
      numbers.forEach { number ->
        val parts = manager.divideMessage(message)
        manager.sendMultipartTextMessage(number, null, parts, null, null)
      }
      promise.resolve(numbers.size)
    } catch (error: Exception) {
      promise.reject("SMS_FAILED", error.message, error)
    }
  }
}
