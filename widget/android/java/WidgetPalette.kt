package __PKG__.widget

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.os.Build
import android.widget.RemoteViews
import androidx.annotation.ColorRes
import androidx.core.content.ContextCompat

/** One colour as the light theme draws it and as the dark theme does. */
internal class ThemedColor(val light: Int, val dark: Int) {
  fun pick(dark: Boolean): Int = if (dark) this.dark else light

  companion object {
    /** A colour that is the same in both themes, such as an activity's own tint. */
    fun fixed(color: Int) = ThemedColor(color, color)
  }
}

/**
 * The one way a widget renderer puts a colour on a view.
 *
 * A launcher keeps the RemoteViews it was given and applies them again when the system switches
 * between light and dark. A resource reference in a layout resolves again then, but a colour
 * resolved to an int, or drawn into a bitmap, at render time keeps the theme that was current
 * when it was rendered: dark text on a dark ground until the next redraw.
 *
 * From API 31 a RemoteViews carries both themes and the host picks by its own configuration when
 * it applies them. So every colour goes in as its light and its dark value, read from `values`
 * and `values-night` through a context for each, and every bitmap is drawn once per theme. Below
 * 31 no RemoteViews action carries two values, so the colour of the theme current at render time
 * is bound, and a switch shows the old theme until the provider next redraws.
 */
internal class WidgetPalette(context: Context) {
  private val both = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
  private val light: Context = if (both) themed(context, dark = false) else context
  private val dark: Context = if (both) themed(context, dark = true) else context

  fun color(@ColorRes id: Int): ThemedColor =
    ThemedColor(ContextCompat.getColor(light, id), ContextCompat.getColor(dark, id))

  fun textColor(v: RemoteViews, viewId: Int, @ColorRes id: Int) = textColor(v, viewId, color(id))

  fun textColor(v: RemoteViews, viewId: Int, color: ThemedColor) =
    bind(v, viewId, "setTextColor", color)

  fun colorFilter(v: RemoteViews, viewId: Int, color: ThemedColor) =
    bind(v, viewId, "setColorFilter", color)

  /** An image drawn by [draw] for each theme it is told is dark or not. */
  fun bitmap(v: RemoteViews, viewId: Int, draw: (dark: Boolean) -> Bitmap) {
    if (both) {
      v.setIcon(
        viewId,
        "setImageIcon",
        Icon.createWithBitmap(draw(false)),
        Icon.createWithBitmap(draw(true)))
    } else {
      v.setImageViewBitmap(viewId, draw(false))
    }
  }

  private fun bind(v: RemoteViews, viewId: Int, method: String, color: ThemedColor) {
    if (both) {
      v.setColorInt(viewId, method, color.light, color.dark)
    } else {
      v.setInt(viewId, method, color.light)
    }
  }

  private companion object {
    fun themed(context: Context, dark: Boolean): Context {
      val config = Configuration(context.resources.configuration)
      val night = if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
      config.uiMode = (config.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or night
      return context.createConfigurationContext(config)
    }
  }
}
