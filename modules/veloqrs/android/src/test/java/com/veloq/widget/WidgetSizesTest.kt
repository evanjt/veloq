package com.veloq.widget

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Scenario: a launcher reports a placement as a range, not one size. A portrait phone draws it at
 * the minimum width and the maximum height, a landscape one at the maximum width and the minimum
 * height, and from API 31 a launcher may list every size it can draw the placement at.
 *
 * Expected behaviour: the sizes a widget lays out for are the launcher's own list where it gives
 * one, else the portrait and landscape pair, never the two minimums together; each layout bucket
 * is drawn once, at the smallest size that falls in it.
 */
class WidgetSizesTest {
  private val phone =
    ReportedSizes(minWidth = 250, minHeight = 160, maxWidth = 420, maxHeight = 220, sizes = emptyList())

  @Test
  fun aPortraitPhoneDrawsTheSummaryAtItsFullHeight() {
    assertEquals(WidgetSize(250, 220), phone.portrait)
    assertEquals(SummarySize.LARGE, SummaryWidget.sizeFor(phone.portrait.widthDp, phone.portrait.heightDp))
    assertEquals(WidgetSize(420, 160), phone.landscape)
    assertEquals(
      SummarySize.MEDIUM, SummaryWidget.sizeFor(phone.landscape.widthDp, phone.landscape.heightDp))
    assertEquals(listOf(WidgetSize(250, 220), WidgetSize(420, 160)), phone.all)
  }

  @Test
  fun eachBucketIsDrawnOnceAtItsSmallestSize() {
    val drawn = WidgetSizes.oneEach(phone.all) { SummaryWidget.sizeFor(it.widthDp, it.heightDp) }
    assertEquals(
      listOf(WidgetSize(250, 220) to SummarySize.LARGE, WidgetSize(420, 160) to SummarySize.MEDIUM),
      drawn)
  }

  @Test
  fun aLaunchersOwnListIsDrawnOncePerBucket() {
    val tablet =
      ReportedSizes(
        minWidth = 300,
        minHeight = 180,
        maxWidth = 520,
        maxHeight = 320,
        sizes =
          listOf(
            WidgetSize(520, 180),
            WidgetSize(300, 320),
            WidgetSize(260, 240),
            WidgetSize(480, 300),
            WidgetSize(150, 90),
          ))
    assertEquals(tablet.sizes, tablet.all)
    val drawn = WidgetSizes.oneEach(tablet.all) { SummaryWidget.sizeFor(it.widthDp, it.heightDp) }
    assertEquals(
      listOf(
        WidgetSize(520, 180) to SummarySize.MEDIUM,
        WidgetSize(260, 240) to SummarySize.LARGE,
        WidgetSize(150, 90) to SummarySize.SHORT,
      ),
      drawn)
  }

  @Test
  fun aBucketIsDrawnAtTheSmallestWidthAndHeightAmongItsSizes() {
    val sizes = listOf(WidgetSize(520, 180), WidgetSize(500, 190))
    val drawn = WidgetSizes.oneEach(sizes) { SummaryWidget.sizeFor(it.widthDp, it.heightDp) }
    assertEquals(listOf(WidgetSize(500, 180) to SummarySize.MEDIUM), drawn)
  }

  @Test
  fun aBucketWhoseMinimumsFallElsewhereIsDrawnAtItsNarrowestSize() {
    val sizes = listOf(WidgetSize(300, 100), WidgetSize(100, 300))
    val diagonal: (WidgetSize) -> Boolean = { it.widthDp + it.heightDp >= 400 }
    assertEquals(listOf(WidgetSize(100, 300) to true), WidgetSizes.oneEach(sizes, diagonal))
  }

  @Test
  fun aPlacementThatFitsOneBucketIsDrawnOnce() {
    val square =
      ReportedSizes(minWidth = 110, minHeight = 110, maxWidth = 150, maxHeight = 150, sizes = emptyList())
    val drawn = WidgetSizes.oneEach(square.all) { LastActivityWidget.sizeFor(it.widthDp, it.heightDp) }
    assertEquals(listOf(WidgetSize(110, 110) to SummarySize.SMALL), drawn)
  }

  @Test
  fun aHostThatReportsNoMaximumKeepsItsMinimum() {
    val minOnly =
      ReportedSizes(minWidth = 250, minHeight = 220, maxWidth = 0, maxHeight = 0, sizes = emptyList())
    assertEquals(listOf(WidgetSize(250, 220)), minOnly.all)
  }

  @Test
  fun aHostThatReportsNothingYetDrawsOneUnsizedLayout() {
    val none = ReportedSizes(minWidth = 0, minHeight = 0, maxWidth = 0, maxHeight = 0, sizes = emptyList())
    assertEquals(listOf(WidgetSize(0, 0)), none.all)
    val drawn = WidgetSizes.oneEach(none.all) { SummaryWidget.sizeFor(it.widthDp, it.heightDp) }
    assertEquals(listOf(WidgetSize(0, 0) to SummarySize.SMALL), drawn)
  }

  @Test
  fun twoLargeSizesWhoseFormStripsDifferAreDrawnOnceEach() {
    val sizes = listOf(WidgetSize(250, 340), WidgetSize(250, 440), WidgetSize(420, 160), WidgetSize(420, 180))
    val drawn = WidgetSizes.oneEach(sizes) { SummaryWidget.layoutFor(it.widthDp, it.heightDp, 1f) }
    assertEquals(
      listOf(WidgetSize(250, 340), WidgetSize(250, 440), WidgetSize(420, 160)),
      drawn.map { it.first })
    assertEquals(
      listOf(SummarySize.LARGE, SummarySize.LARGE, SummarySize.MEDIUM), drawn.map { it.second.size })
    assertEquals(
      drawn[0].second.formStripDp + 100, drawn[1].second.formStripDp)
  }
}
