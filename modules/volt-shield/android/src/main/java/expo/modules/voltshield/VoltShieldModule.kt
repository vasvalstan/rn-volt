package expo.modules.voltshield

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Calendar

internal const val PREFS_NAME = "VoltShieldPrefs"
internal const val BLOCKED_PACKAGES_KEY = "blockedPackages"
internal const val FUEL_MINUTES_KEY = "fuelMinutesAvailable"

private val SOCIAL_MEDIA_PACKAGES = setOf(
  "com.instagram.android",
  "com.zhiliaoapp.musically",
  "com.ss.android.ugc.trill",
  "com.facebook.katana",
  "com.facebook.lite",
  "com.twitter.android",
  "com.twitter.android.lite",
  "com.snapchat.android",
  "com.google.android.youtube",
  "com.reddit.frontpage",
  "com.pinterest",
  "com.discord",
  "com.tumblr",
  "com.linkedin.android",
  "org.telegram.messenger",
  "com.whatsapp",
  "com.Slack",
)

class VoltShieldModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VoltShield")

    AsyncFunction("isUsageAccessGranted") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      isUsageAccessGranted(context)
    }

    AsyncFunction("openUsageAccessSettings") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      context.startActivity(
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      )
      null
    }

    AsyncFunction("isAccessibilityServiceEnabled") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      isAccessibilityServiceEnabled(context)
    }

    AsyncFunction("openAccessibilitySettings") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      context.startActivity(
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      )
      null
    }

    AsyncFunction("setBlockedPackages") { packages: List<String> ->
      val context = appContext.reactContext ?: return@AsyncFunction null
      prefs(context)
        .edit()
        .putStringSet(BLOCKED_PACKAGES_KEY, packages.toSet())
        .apply()
      null
    }

    AsyncFunction("getBlockedPackages") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<String>()
      prefs(context).getStringSet(BLOCKED_PACKAGES_KEY, emptySet<String>())?.toList() ?: emptyList<String>()
    }

    AsyncFunction("setFuelMinutesAvailable") { minutes: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction null
      prefs(context)
        .edit()
        .putInt(FUEL_MINUTES_KEY, minutes.coerceAtLeast(0))
        .apply()
      null
    }

    AsyncFunction("getSocialMediaUsageMinutes") { days: Int ->
      val context = appContext.reactContext
        ?: return@AsyncFunction mapOf(
          "dailyAverageMinutes" to 0,
          "todayMinutes" to 0,
          "daysOfData" to 0,
        )

      if (!isUsageAccessGranted(context)) {
        return@AsyncFunction mapOf(
          "dailyAverageMinutes" to 0,
          "todayMinutes" to 0,
          "daysOfData" to 0,
        )
      }

      val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

      val now = Calendar.getInstance()
      val endTime = now.timeInMillis

      val startOfToday = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
      }

      // Today's usage
      val todayStats = usm.queryUsageStats(
        UsageStatsManager.INTERVAL_DAILY,
        startOfToday.timeInMillis,
        endTime
      )
      val todayMs = todayStats
        .filter { it.packageName in SOCIAL_MEDIA_PACKAGES }
        .sumOf { it.totalTimeInForeground }
      val todayMinutes = (todayMs / 60_000).toInt()

      // Historical usage (past N days excluding today)
      val lookbackDays = days.coerceIn(1, 30)
      val historyStart = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, -lookbackDays)
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
      }

      val allStats = usm.queryUsageStats(
        UsageStatsManager.INTERVAL_DAILY,
        historyStart.timeInMillis,
        endTime
      )
      val totalMs = allStats
        .filter { it.packageName in SOCIAL_MEDIA_PACKAGES }
        .sumOf { it.totalTimeInForeground }

      val daysWithData = if (totalMs > 0) lookbackDays.coerceAtLeast(1) else 0
      val dailyAvg = if (daysWithData > 0) (totalMs / 60_000 / daysWithData).toInt() else 0

      mapOf(
        "dailyAverageMinutes" to dailyAvg,
        "todayMinutes" to todayMinutes,
        "daysOfData" to daysWithData,
      )
    }
  }
}

internal fun prefs(context: Context) =
  context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

internal fun isUsageAccessGranted(context: Context): Boolean {
  val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
  val mode = appOps.unsafeCheckOpNoThrow(
    AppOpsManager.OPSTR_GET_USAGE_STATS,
    Process.myUid(),
    context.packageName
  )
  return mode == AppOpsManager.MODE_ALLOWED
}

internal fun isAccessibilityServiceEnabled(context: Context): Boolean {
  val componentName =
    ComponentName(context, VoltShieldAccessibilityService::class.java).flattenToString()
  val enabledServices =
    Settings.Secure.getString(
      context.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false

  return enabledServices.split(':').any { it.equals(componentName, ignoreCase = true) }
}
