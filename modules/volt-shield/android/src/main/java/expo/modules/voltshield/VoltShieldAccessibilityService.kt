package expo.modules.voltshield

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast
import androidx.core.app.NotificationCompat

private const val INTERCEPT_THROTTLE_MS = 1200L
private const val FUEL_NOTIFICATION_ID = 92001
private const val FUEL_CHANNEL_ID = "volt_fuel_awareness"

class VoltShieldAccessibilityService : AccessibilityService() {
  private var lastInterceptedPackage: String? = null
  private var lastInterceptedAt = 0L

  override fun onServiceConnected() {
    serviceInfo = AccessibilityServiceInfo().apply {
      eventTypes =
        AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or AccessibilityEvent.TYPE_WINDOWS_CHANGED
      feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
      notificationTimeout = 100
      flags = AccessibilityServiceInfo.DEFAULT
    }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val packageName = event?.packageName?.toString() ?: return
    if (!shouldBlock(packageName)) return

    val now = System.currentTimeMillis()
    if (packageName == lastInterceptedPackage && now - lastInterceptedAt < INTERCEPT_THROTTLE_MS) {
      return
    }

    lastInterceptedPackage = packageName
    lastInterceptedAt = now
    redirectToVolt()
  }

  override fun onInterrupt() = Unit

  private fun shouldBlock(packageName: String): Boolean {
    if (packageName == this.packageName) return false
    if (packageName == "com.android.systemui") return false
    if (packageName == "com.android.settings") return false
    if (packageName.contains("launcher", ignoreCase = true)) return false

    val preferences = prefs(this)
    if (!preferences.getBoolean(SHIELD_ENABLED_KEY, true)) return false

    val unlockUntil = preferences.getLong(SHIELD_UNLOCK_UNTIL_KEY, 0L)
    if (unlockUntil > System.currentTimeMillis()) return false
    if (unlockUntil > 0L) {
      preferences.edit().putLong(SHIELD_UNLOCK_UNTIL_KEY, 0L).apply()
    }

    val blockedPackages =
      preferences.getStringSet(BLOCKED_PACKAGES_KEY, emptySet<String>()) ?: emptySet<String>()
    return blockedPackages.contains(packageName)
  }

  private fun fuelMinutes(): Int =
    prefs(this).getInt(FUEL_MINUTES_KEY, 0).coerceAtLeast(0)

  private fun postFuelAwarenessNotification(fuelMin: Int) {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch =
        NotificationChannel(
          FUEL_CHANNEL_ID,
          "Unlock fuel reminders",
          NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
          description = "Shows your remaining unlock minutes when you open a blocked app"
        }
      nm.createNotificationChannel(ch)
    }
    val body =
      if (fuelMin > 0) {
        "You have $fuelMin unlock minute${if (fuelMin == 1) "" else "s"} in your fuel bank. Log scroll time in Volt (Settings) before you scroll."
      } else {
        "Fuel bank is empty. Open Volt to earn unlock minutes with a quick workout."
      }
    val notif =
      NotificationCompat.Builder(this, FUEL_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
        .setContentTitle("Volt · Blocked app")
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .build()
    nm.notify(FUEL_NOTIFICATION_ID, notif)
  }

  private fun redirectToVolt() {
    val fuel = fuelMinutes()
    performGlobalAction(GLOBAL_ACTION_HOME)

    Handler(Looper.getMainLooper()).postDelayed(
      {
        postFuelAwarenessNotification(fuel)

        val toastText =
          if (fuel > 0) {
            "Volt: $fuel unlock min in your bank — log spend in Volt before scrolling."
          } else {
            "App locked. Open Volt to earn unlock minutes."
          }
        Toast.makeText(this, toastText, Toast.LENGTH_LONG).show()

        val voltPkg = applicationContext.packageName
        val voltLaunch =
          packageManager.getLaunchIntentForPackage(voltPkg)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
          }
        if (voltLaunch != null) {
          startActivity(voltLaunch)
        }
      },
      120
    )
  }
}
