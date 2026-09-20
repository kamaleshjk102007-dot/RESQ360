package com.safeguard.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

class EmergencyCallModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "EmergencyCall"

  @ReactMethod
  fun callNumbers(rawNumbers: ReadableArray, promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("CALL_PERMISSION", "Phone-call permission is not granted")
      return
    }
    val number = (0 until rawNumbers.size()).mapNotNull { rawNumbers.getString(it) }
      .map { it.filter { ch -> ch.isDigit() || ch == '+' } }.firstOrNull { it.isNotBlank() }
    if (number == null) {
      promise.reject("NO_CONTACTS", "No valid emergency contact number is saved")
      return
    }
    try {
      context.startActivity(Intent(Intent.ACTION_CALL, Uri.parse("tel:$number")).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
      promise.resolve(1)
    } catch (error: Exception) {
      promise.reject("CALL_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun cancelCalls() {
    // The app never ends a cellular call; this only preserves the JS API.
  }
}
