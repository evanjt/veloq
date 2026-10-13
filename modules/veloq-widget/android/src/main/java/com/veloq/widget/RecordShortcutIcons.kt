package com.veloq.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import kotlin.math.roundToInt

/**
 * The icon a launcher shortcut draws for one sport: the sport category's glyph on
 * the brand fill, as an adaptive icon so the launcher masks it to its own shape.
 * The category key comes with the shortcut, so the app's one sport grouping decides
 * it and nothing here maps a sport.
 */
internal object RecordShortcutIcons {
  /** The adaptive icon's full canvas and the part of it the glyph covers, in dp. */
  private const val CANVAS_DP = 108f
  private const val GLYPH_DP = 44f

  /** The glyph for a category key; a key this build does not know draws the catch-all. */
  fun glyph(category: String?): Int =
    when (category) {
      "ride" -> R.drawable.shortcut_glyph_ride
      "run" -> R.drawable.shortcut_glyph_run
      "swim" -> R.drawable.shortcut_glyph_swim
      "walk" -> R.drawable.shortcut_glyph_walk
      "hike" -> R.drawable.shortcut_glyph_hike
      "snow" -> R.drawable.shortcut_glyph_snow
      "water" -> R.drawable.shortcut_glyph_water
      "gym" -> R.drawable.shortcut_glyph_gym
      "racket" -> R.drawable.shortcut_glyph_racket
      else -> R.drawable.shortcut_glyph_other
    }

  /**
   * Drawn into a bitmap rather than declared as an adaptive-icon resource, because
   * the compat library masks a bitmap on the launchers that predate adaptive icons
   * and an adaptive-icon resource does not inflate there.
   */
  fun icon(ctx: Context, category: String?): IconCompat {
    val density = ctx.resources.displayMetrics.density
    val size = (CANVAS_DP * density).roundToInt()
    val inset = ((CANVAS_DP - GLYPH_DP) / 2 * density).roundToInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(ContextCompat.getColor(ctx, R.color.veloq_shortcut_background))
    ContextCompat.getDrawable(ctx, glyph(category))?.let {
      it.setBounds(inset, inset, size - inset, size - inset)
      it.draw(canvas)
    }
    return IconCompat.createWithAdaptiveBitmap(bitmap)
  }
}
