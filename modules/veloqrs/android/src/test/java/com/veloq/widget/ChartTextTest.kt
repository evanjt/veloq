package com.veloq.widget

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Scenario: a widget chart is a bitmap, so the system cannot scale the axis labels painted
 * into it the way it scales a TextView's sp text.
 *
 * Expected behaviour: a label is the caption size at the reader's font scale, up to the cap the
 * data-dense surfaces share, at any density.
 */
class ChartTextTest {
  private val caption = 11f
  private val cap = 1.3f

  @Test
  fun at_the_default_scale_a_label_is_the_caption_size() {
    assertEquals(11f, ChartText.axisLabelPx(caption, 1f, 1f, cap), 0.001f)
    assertEquals(33f, ChartText.axisLabelPx(caption, 3f, 1f, cap), 0.001f)
  }

  @Test
  fun a_larger_scale_grows_the_label_up_to_the_cap() {
    assertEquals(11f * 1.15f * 3f, ChartText.axisLabelPx(caption, 3f, 1.15f, cap), 0.001f)
    assertEquals(11f * 1.3f * 3f, ChartText.axisLabelPx(caption, 3f, 2f, cap), 0.001f)
  }

  @Test
  fun a_smaller_scale_shrinks_the_label() {
    assertEquals(11f * 0.85f * 2f, ChartText.axisLabelPx(caption, 2f, 0.85f, cap), 0.001f)
  }
}
