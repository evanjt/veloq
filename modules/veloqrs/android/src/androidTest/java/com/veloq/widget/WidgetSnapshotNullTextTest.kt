package com.veloq.widget

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.veloq.test.widget.WidgetSnapshot
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Scenario: a snapshot carries a JSON null where a native expects an optional line of text.
 *
 * Expected behaviour: every optional text reads back as absent, never as the word "null". The
 * platform's own `org.json` turns a null into "null" through `optString`, where the JVM artifact
 * the unit tests use returns the fallback, so this runs on a device.
 */
@RunWith(AndroidJUnit4::class)
class WidgetSnapshotNullTextTest {
  private fun demo(): JSONObject {
    val text =
      InstrumentationRegistry.getInstrumentation().context.assets.open("demo.json").use {
        it.readBytes().toString(Charsets.UTF_8)
      }
    return JSONObject(text)
  }

  private fun nulled(o: JSONObject, vararg keys: String) {
    for (key in keys) o.put(key, JSONObject.NULL)
  }

  @Test
  fun everyOptionalTextReadsANullAsAbsent() {
    val root = demo()
    val latest = root.getJSONObject("latest")
    nulled(latest, "activityId", "loadText", "sectionPrsText")
    nulled(latest.getJSONObject("headline"), "detail")
    nulled(
      root.getJSONObject("impact"),
      "formBeforeText",
      "formAfterText",
      "formBeforeZone",
      "formAfterZone",
    )
    nulled(root.getJSONObject("display"), "formZone", "demoLabel", "dataAsOfLabel")
    nulled(root.getJSONObject("metrics").getJSONObject("form"), "zone", "text")

    val snap = WidgetSnapshot.parse(root)

    val parsedLatest = snap.latest
    assertNotNull(parsedLatest)
    val texts =
      mapOf(
        "activityId" to parsedLatest!!.activityId,
        "loadText" to parsedLatest.loadText,
        "sectionPrsText" to parsedLatest.sectionPrsText,
        "headline.detail" to parsedLatest.headline?.detail,
        "formBeforeText" to snap.impact?.beforeText,
        "formAfterText" to snap.impact?.afterText,
        "formBeforeZone" to snap.impact?.beforeZone,
        "formAfterZone" to snap.impact?.afterZone,
        "formZone" to snap.formZoneLabel,
        "demoLabel" to snap.demoLabel,
        "dataAsOfLabel" to snap.dataAsOfLabel,
        "form.zone" to snap.form.zone,
        "form.text" to snap.form.text,
      )
    assertEquals(texts.mapValues { null }, texts)
  }
}
