package __PKG__.widget

import android.content.SharedPreferences

/**
 * Moves each placed widget's stored choice from its old id to its new one when a launcher restores
 * widgets, which it does under new ids and without rerunning the picker.
 *
 * Old and new ids can overlap, so every old value is read before any is written: a restored widget
 * whose new id was another widget's old id gets its own choice, never the other widget's.
 */
object WidgetIdRemap {
  /** [values] with every key of [prefixes] moved from `oldIds[i]` to `newIds[i]`. */
  fun remap(
    values: Map<String, Any?>,
    prefixes: List<String>,
    oldIds: IntArray,
    newIds: IntArray,
  ): Map<String, Any?> {
    val result = values.toMutableMap()
    for (prefix in prefixes) for (old in oldIds) result.remove(prefix + old)
    for (prefix in prefixes) {
      for ((old, new) in oldIds.zip(newIds)) {
        val value = values[prefix + old]
        if (value == null) result.remove(prefix + new) else result[prefix + new] = value
      }
    }
    return result
  }

  /** Applies [remap] to [prefs] in one edit. */
  fun rewrite(prefs: SharedPreferences, prefixes: List<String>, oldIds: IntArray, newIds: IntArray) {
    val before = prefs.all
    val after = remap(before, prefixes, oldIds, newIds)
    val editor = prefs.edit()
    for (key in before.keys - after.keys) editor.remove(key)
    for ((key, value) in after) {
      if (before[key] == value) continue
      @Suppress("UNCHECKED_CAST")
      when (value) {
        is String -> editor.putString(key, value)
        is Set<*> -> editor.putStringSet(key, value as Set<String>)
      }
    }
    editor.apply()
  }
}
