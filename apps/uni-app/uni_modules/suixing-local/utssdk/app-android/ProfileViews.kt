package uts.sdk.modules.suixingLocal

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.ProfileStore
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

object ProfileViews {
    private const val replyPrefix = "suixingbridge://reply?payload="
    private data class Host(val container: LinearLayout, val web: WebView, val event: (String, String) -> Unit)
    private val views = mutableMapOf<String, Host>()

    fun supported(): Boolean = try {
        WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
    } catch (_: RuntimeException) { false }

    private fun official(url: String?): Boolean {
        val value = Uri.parse(url ?: return false)
        val host = value.host ?: return false
        return value.scheme == "https" && value.port in listOf(-1, 443) &&
            listOf("icloud.com", "icloud.com.cn", "apple.com", "apple.com.cn").any {
                host.equals(it, true) || host.endsWith(".$it", true)
            }
    }

    /** 在任何导航或脚本执行前绑定 WebView 配置。官方页面只可通过被拦截的回执返回数据。 */
    fun open(activity: Activity, id: String, url: String, event: (String, String) -> Unit) {
        activity.runOnUiThread {
            try {
                require(supported() && Regex("[a-z0-9]{20,48}").matches(id) && official(url))
                close(id)
                val web = WebView(activity)
                WebViewCompat.setProfile(web, "suixing-$id")
                with(web.settings) {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    allowFileAccess = false
                    allowContentAccess = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    javaScriptCanOpenWindowsAutomatically = false
                    setSupportMultipleWindows(false)
                    setGeolocationEnabled(false)
                }
                val profile = WebViewCompat.getProfile(web)
                profile.cookieManager.setAcceptThirdPartyCookies(web, true)
                val root = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.WHITE)
                    // 保持网页挂载以读取官方页面，整块容器移出可见范围并禁用触摸。
                    translationX = -100000f
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                }
                val toolbar = FrameLayout(activity).apply { setBackgroundColor(Color.rgb(246, 247, 249)) }
                val density = activity.resources.displayMetrics.density
                val title = TextView(activity).apply {
                    text = "iCloud 官方页面"
                    gravity = Gravity.CENTER
                    setTextColor(Color.rgb(32, 39, 53))
                    textSize = 16f
                }
                val back = Button(activity).apply {
                    text = "返回应用"
                    setOnClickListener { show(id, false) }
                }
                toolbar.addView(title, FrameLayout.LayoutParams(-1, -1))
                toolbar.addView(back, FrameLayout.LayoutParams(-2, -1, Gravity.END))
                root.addView(toolbar, LinearLayout.LayoutParams(-1, (48 * density).toInt()))
                root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
                web.webChromeClient = object : WebChromeClient() {
                    override fun onPermissionRequest(request: PermissionRequest) = request.deny()
                }
                web.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val target = request.url.toString()
                        if (target.startsWith(replyPrefix)) {
                            if (request.isForMainFrame && official(view.url)) event("reply", target)
                            return true
                        }
                        return !official(target)
                    }
                    override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                        if (!official(url)) { view.stopLoading(); event("error", ""); return }
                        event("loading", url)
                    }
                    override fun onPageFinished(view: WebView, url: String) {
                        if (official(url)) event("loaded", url)
                    }
                    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                        if (request.isForMainFrame) event("error", "")
                    }
                }
                views[id] = Host(root, web, event)
                activity.addContentView(root, ViewGroup.LayoutParams(-1, -1))
                web.loadUrl(url)
            } catch (_: Exception) {
                close(id)
                event("error", "")
            }
        }
    }

    fun action(activity: Activity, id: String, action: String, value: String) {
        activity.runOnUiThread {
            val host = views[id] ?: return@runOnUiThread
            when (action) {
                "show" -> show(id, true)
                "hide" -> show(id, false)
                "close" -> close(id)
                "reload" -> if (official(host.web.url)) host.web.reload()
                "load" -> if (official(value)) host.web.loadUrl(value)
                "evaluate" -> if (official(host.web.url)) host.web.evaluateJavascript(value, null)
            }
        }
    }

    private fun show(id: String, visible: Boolean) {
        val host = views[id] ?: return
        host.container.translationX = if (visible) 0f else -100000f
        host.container.importantForAccessibility = if (visible) View.IMPORTANT_FOR_ACCESSIBILITY_AUTO else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        host.event(if (visible) "show" else "hide", "")
    }

    private fun close(id: String) {
        val host = views.remove(id) ?: return
        try {
            if (official(host.web.url)) WebViewCompat.getProfile(host.web).cookieManager.flush()
        } catch (_: RuntimeException) { /* 仍需销毁已经关闭的容器。 */ }
        (host.container.parent as? ViewGroup)?.removeView(host.container)
        host.container.removeView(host.web)
        host.web.destroy()
        host.event("close", "")
    }

    /** 已载入的配置无法直接删除，优先使用 WebView 的完整浏览数据清理能力。 */
    fun forget(activity: Activity, id: String, done: (Boolean) -> Unit) {
        activity.runOnUiThread {
            try {
                if (id.startsWith("legacy-")) {
                    if (supported() && WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
                        val profile = ProfileStore.getInstance().getProfile("Default") ?: error("默认会话不可用")
                        clear(profile, done)
                    } else {
                        val cookies = CookieManager.getInstance()
                        cookies.removeAllCookies {
                            cookies.flush()
                            WebStorage.getInstance().deleteAllData()
                            done(true)
                        }
                    }
                    return@runOnUiThread
                }
                require(supported())
                require(Regex("[a-z0-9]{20,48}").matches(id))
                close(id)
                val store = ProfileStore.getInstance()
                val name = "suixing-$id"
                try { store.deleteProfile(name); done(true) }
                catch (_: IllegalStateException) { clear(store.getProfile(name) ?: error("会话不可用"), done) }
            } catch (_: Exception) { done(false) }
        }
    }

    private fun clear(profile: androidx.webkit.Profile, done: (Boolean) -> Unit) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
            val cookies = profile.cookieManager
            cookies.removeAllCookies {
                cookies.flush()
                profile.webStorage.deleteAllData()
                done(true)
            }
            return
        }
        WebStorageCompat.deleteBrowsingData(profile.webStorage) { done(true) }
    }
}
