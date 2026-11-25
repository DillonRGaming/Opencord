package monster.orbital.opencord

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : TauriActivity() {
  // What a tapped notification asked for, until the page picks it up (see public/js/views/androidPush.js).
  @Volatile private var pendingAction: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    take(intent)
    // Make sure there's a push token, even on first launch.
    FirebaseMessaging.getInstance().token.addOnSuccessListener { Push.saveToken(this, it) }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    take(intent)
  }

  private fun take(intent: Intent?) {
    val action = intent?.getStringExtra(Push.EXTRA_ACTION) ?: return
    intent.removeExtra(Push.EXTRA_ACTION)
    pendingAction = action
    if (action.startsWith("call:")) {
      Push.stopRinging(this, action.removePrefix("call:"))
      // Answering from the lock screen: show the app over it and turn the screen on.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) { setShowWhenLocked(true); setTurnScreenOn(true) }
    }
  }

  // The page (only ever orbital.monster) reads the push token and pending actions through this.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    // Sound can start without a tap first (the sign-up music, the ringtone on an incoming call).
    webView.settings.mediaPlaybackRequiresUserGesture = false
    // Android draws apps edge to edge: keep the page clear of the status bar, the navigation bar, a camera
    // notch, and the keyboard while it's open.
    // (The padding goes on the page's container: a WebView doesn't lay its page out inside its own padding.)
    val container = findViewById<android.view.View>(android.R.id.content)
    container.setBackgroundColor(android.graphics.Color.parseColor("#0a0a0a"))
    ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    webView.addJavascriptInterface(object {
      @JavascriptInterface fun token(): String = Push.token(this@MainActivity) ?: ""
      @JavascriptInterface fun takeAction(): String { val a = pendingAction ?: ""; pendingAction = null; return a }
    }, "OpencordPush")
  }
}
