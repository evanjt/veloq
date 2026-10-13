import XCTest

@testable import VeloqWidget

/// Scenario: an Insights widget row marks its insight with a glyph rather than a coloured dot, so
/// the mark still says something in the tinted and clear modes, where every row is one colour.
///
/// Expected behaviour: each icon the Insights tab draws has its own symbol, and a row with no icon,
/// or one this build does not know, draws a symbol for its tone, a different one for each tone.
final class InsightSymbolTests: XCTestCase {
  private let tones = ["negative", "caution", "positive", "neutral", "record", "info", "opportunity"]

  func testEveryToneHasItsOwnSymbolWhenTheRowHasNoIcon() {
    let symbols = tones.map { insightSymbol(icon: nil, tone: $0) }
    XCTAssertEqual(Set(symbols).count, tones.count, "\(zip(tones, symbols).map { "\($0)=\($1)" })")
  }

  func testAnIconTheWidgetDoesNotKnowDrawsItsTone() {
    for tone in tones {
      XCTAssertEqual(
        insightSymbol(icon: "alien-outline", tone: tone), insightSymbol(icon: nil, tone: tone))
      XCTAssertEqual(insightSymbol(icon: "", tone: tone), insightSymbol(icon: nil, tone: tone))
    }
  }

  func testAToneTheWidgetDoesNotKnowDrawsNeutral() {
    XCTAssertEqual(insightSymbol(icon: nil, tone: "jubilant"), insightSymbol(icon: nil, tone: "neutral"))
    XCTAssertEqual(insightSymbol(icon: nil, tone: nil), insightSymbol(icon: nil, tone: "neutral"))
  }

  func testEachIconTheTabDrawsHasTheTabsGlyph() {
    let expected = [
      "trending-up": "chart.line.uptrend.xyaxis",
      "trending-down": "chart.line.downtrend.xyaxis",
      "minus": "minus",
      "trophy-outline": "trophy",
      "lightning-bolt": "bolt",
      "run-fast": "figure.run",
      "swim": "figure.pool.swim",
      "heart-pulse": "waveform.path.ecg",
      "history": "clock.arrow.circlepath",
      "scale-balance": "scalemass",
      "arm-flex-outline": "figure.strengthtraining.traditional",
      "dumbbell": "dumbbell",
    ]
    for (icon, symbol) in expected {
      XCTAssertEqual(insightSymbol(icon: icon, tone: "info"), symbol, icon)
    }
  }
}
