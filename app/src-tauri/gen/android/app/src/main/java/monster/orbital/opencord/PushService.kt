package monster.orbital.opencord

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

// Pushes from the Opencord server (through Firebase), received even while the app is closed:
//   call      → rings like a phone call (full screen when locked) until answered, declined or it ends
//   call_end  → stops that ringing
//   message   → a normal notification for a DM or mention
class PushService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    Push.saveToken(this, token)
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    val channelId = data["channelId"] ?: return
    when (data["type"]) {
      "call" -> Push.ring(this, channelId, data["title"] ?: "Someone", data["body"] ?: "Incoming call…")
      "call_end" -> Push.stopRinging(this, channelId)
      "message" -> Push.message(this, channelId, data["serverId"] ?: "", data["title"] ?: "Opencord", data["body"] ?: "")
    }
  }
}

// "Decline" on the ringing notification.
class DeclineReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Push.stopRinging(context, intent.getStringExtra("channelId") ?: return)
  }
}

object Push {
  private const val PREFS = "opencord_push"
  private const val CALLS = "incoming_calls"
  private const val MESSAGES = "push_messages"
  const val EXTRA_ACTION = "opencord_action"

  fun saveToken(context: Context, token: String) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("token", token).apply()

  fun token(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("token", null)

  private fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val calls = NotificationChannel(CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Rings when someone calls you"
      setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 800, 600, 800, 600)
      lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
    }
    val messages = NotificationChannel(MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "DMs and mentions while Opencord is closed"
      enableVibration(true)
    }
    manager.createNotificationChannels(listOf(calls, messages))
  }

  // Opens the app, telling the page what to do ("call:<id>" joins the call, "open:<id>:<server>" opens the chat).
  private fun openApp(context: Context, action: String, requestCode: Int): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra(EXTRA_ACTION, action)
    }
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun idFor(channelId: String) = channelId.hashCode()

  fun ring(context: Context, channelId: String, caller: String, text: String) {
    ensureChannels(context)
    val id = idFor(channelId)
    val decline = PendingIntent.getBroadcast(context, id,
      Intent(context, DeclineReceiver::class.java).putExtra("channelId", channelId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val accept = openApp(context, "call:$channelId", id)
    val notification = NotificationCompat.Builder(context, CALLS)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(caller)
      .setContentText(text)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setOngoing(true)
      .setAutoCancel(true)
      .setTimeoutAfter(30_000)
      .setContentIntent(accept)
      .setFullScreenIntent(accept, true)
      .addAction(0, "Decline", decline)
      .addAction(0, "Accept", accept)
      .build()
    notification.flags = notification.flags or android.app.Notification.FLAG_INSISTENT // keeps ringing
    show(context, id, notification)
  }

  fun stopRinging(context: Context, channelId: String) =
    NotificationManagerCompat.from(context).cancel(idFor(channelId))

  fun message(context: Context, channelId: String, serverId: String, title: String, body: String) {
    ensureChannels(context)
    val id = idFor("msg:$channelId")
    val notification = NotificationCompat.Builder(context, MESSAGES)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setAutoCancel(true)
      .setContentIntent(openApp(context, "open:$channelId:$serverId", id))
      .build()
    show(context, id, notification)
  }

  private fun show(context: Context, id: Int, notification: android.app.Notification) {
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (_: SecurityException) {
      // Notifications not allowed: nothing to show.
    }
  }
}
