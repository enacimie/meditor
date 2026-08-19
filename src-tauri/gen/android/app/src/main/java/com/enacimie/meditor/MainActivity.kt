package com.enacimie.meditor

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private val safeArea = SafeArea()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)

    // The window is edge-to-edge, and neither wry nor Tauri hands the system
    // window insets (status bar, gesture bar, display cutout) to the web
    // layer. Expose them here so the frontend can pad the top bar and status
    // bar away from the system UI instead of drawing underneath it.
    webView.addJavascriptInterface(safeArea, "MeditorSafeArea")

    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, insets ->
      val bars =
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      val i = insets.getInsets(bars)
      safeArea.update(i.top, i.bottom, i.left, i.right)

      // The web content can load before or after the first inset pass; push
      // the values now as well as exposing them through the bridge, so the
      // CSS variables are right whichever side wins the race.
      webView.evaluateJavascript(
        "(function(){var s=document.documentElement.style;" +
          "s.setProperty('--safe-area-top','${i.top}px');" +
          "s.setProperty('--safe-area-bottom','${i.bottom}px');" +
          "s.setProperty('--safe-area-left','${i.left}px');" +
          "s.setProperty('--safe-area-right','${i.right}px');})()",
        null,
      )
      insets
    }
    ViewCompat.requestApplyInsets(window.decorView)
  }

  class SafeArea {
    @Volatile private var topPx = 0
    @Volatile private var bottomPx = 0
    @Volatile private var leftPx = 0
    @Volatile private var rightPx = 0

    fun update(top: Int, bottom: Int, left: Int, right: Int) {
      topPx = top
      bottomPx = bottom
      leftPx = left
      rightPx = right
    }

    @JavascriptInterface
    fun top(): Int = topPx

    @JavascriptInterface
    fun bottom(): Int = bottomPx

    @JavascriptInterface
    fun left(): Int = leftPx

    @JavascriptInterface
    fun right(): Int = rightPx
  }
}
