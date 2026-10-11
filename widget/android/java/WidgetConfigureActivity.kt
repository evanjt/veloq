package __PKG__.widget

import android.view.View
import android.view.ViewGroup
import androidx.annotation.LayoutRes
import androidx.annotation.StringRes
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.appbar.MaterialToolbar
import __PKG__.R

/**
 * The frame every widget picker shares. A toolbar names the widget being set up, and the picker's
 * own layout sits under it. The window draws edge to edge on every Android version, and the system
 * bar insets are applied here once: the top to the toolbar's bar, the sides to the whole frame, and
 * the bottom to the picker's scrolling root, so the last row and the Save button scroll clear of
 * the navigation bar.
 *
 * The theme is the one the widget plugin sets on every picker's manifest entry, Material 3 in the
 * brand colours, so the controls a picker builds are Material components.
 */
abstract class WidgetConfigureActivity : AppCompatActivity() {
  /** Shows [layout] under a toolbar titled [title]. */
  protected fun showPicker(@StringRes title: Int, @LayoutRes layout: Int) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    setContentView(R.layout.widget_configure_shell)
    findViewById<MaterialToolbar>(R.id.widget_configure_toolbar).setTitle(title)

    val content = findViewById<ViewGroup>(R.id.widget_configure_content)
    val body = layoutInflater.inflate(layout, content, false)
    content.addView(body)
    (body as? ViewGroup)?.clipToPadding = false

    val root = findViewById<View>(R.id.widget_configure_root)
    val bar = findViewById<View>(R.id.widget_configure_bar)
    val bodyBottom = body.paddingBottom
    ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
      val edges =
        insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      root.setPadding(edges.left, 0, edges.right, 0)
      bar.setPadding(0, edges.top, 0, 0)
      body.setPadding(body.paddingLeft, body.paddingTop, body.paddingRight, bodyBottom + edges.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
