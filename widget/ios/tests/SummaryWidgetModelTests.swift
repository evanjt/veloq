import XCTest

@testable import VeloqWidget

/// Scenario: the Summary widget draws a verdict and a form zone on a Home Screen that may draw
/// it in one colour.
///
/// Expected behaviour: the verdict changes the trend symbol and not only its colour, so a rise
/// judged worse reads apart from a rise judged better; and the Form entry on the supporting row
/// carries its zone in words.
final class SummaryWidgetModelTests: XCTestCase {
  private func snapshot(_ fixture: String) throws -> WidgetSnapshot {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: fixture, withExtension: "json", subdirectory: "fixtures"))
    return try JSONDecoder().decode(WidgetSnapshot.self, from: Data(contentsOf: url))
  }

  func testTheVerdictChangesTheSymbolWhateverTheDirection() {
    for dir in ["up", "down", "flat"] {
      let symbols = ["improved", "declined", "flat"].map { trendSymbol(dir, $0) }
      XCTAssertEqual(Set(symbols).count, 3, "\(dir): \(symbols)")
    }
  }

  func testTheDirectionStillChangesTheSymbol() {
    for verdict in ["improved", "declined", "flat"] {
      let symbols = ["up", "down", "flat"].map { trendSymbol($0, verdict) }
      XCTAssertEqual(Set(symbols).count, 3, "\(verdict): \(symbols)")
    }
  }

  func testNoVerdictAndAnUnknownVerdictDrawAsFlat() {
    XCTAssertEqual(trendSymbol("up", nil), trendSymbol("up", "flat"))
    XCTAssertEqual(trendSymbol("up", "moved"), trendSymbol("up", "flat"))
  }

  func testTheFormEntryOnTheRowCarriesItsZoneWord() throws {
    let snapshot = try self.snapshot("demo")
    let content = SummaryWidgetModel.content(
      snapshot, placement: SummaryPlacement(hero: "fitness"), size: .medium)
    let form = try XCTUnwrap(content.supporting.first { $0.entry.id == "form" })
    XCTAssertEqual(form.caption, snapshot.display.formZone)
    XCTAssertNotNil(form.caption)
    for other in content.supporting where other.entry.id != "form" {
      XCTAssertNil(other.caption, other.entry.id)
    }
  }

  func testAFormHeroKeepsItsZoneOnTheHeroLineAndTheRowCarriesNone() throws {
    let snapshot = try self.snapshot("demo")
    let content = SummaryWidgetModel.content(snapshot, placement: .followCard, size: .large)
    XCTAssertEqual(content.hero.id, "form")
    XCTAssertEqual(content.heroLine, snapshot.display.formZone)
    XCTAssertTrue(content.supporting.allSatisfy { $0.caption == nil })
  }

  /// Scenario: the chart beside the hero draws two lines and the large size draws form over its
  /// zones, neither of which says on its own what it is or how many days it spans.
  ///
  /// Expected behaviour: the chart's caption names fitness and fatigue in the order their lines
  /// are told apart and the days they span, and the form chart names itself, today's zone and
  /// its span, all in the snapshot's words.
  func testTheChartsNameTheirSeriesSpanAndZone() throws {
    let snapshot = try self.snapshot("demo")
    let labels = snapshot.display.metricLabels
    for size in [SummarySize.medium, .large] {
      let content = SummaryWidgetModel.content(snapshot, placement: .followCard, size: size)
      XCTAssertEqual(content.chart, .fitnessForm)
      XCTAssertEqual(
        content.chartCaption,
        ChartCaption(series: [labels.fitness, labels.fatigue], span: "30 days"))
    }
    let large = SummaryWidgetModel.content(snapshot, placement: .followCard, size: .large)
    XCTAssertEqual(
      large.formCaption,
      FormChartCaption(title: labels.form, zone: "Grey Zone", span: "42 days"))
  }

  func testSmallHasNoRoomForACaptionAndMediumNoFormChart() throws {
    let snapshot = try self.snapshot("demo")
    let small = SummaryWidgetModel.content(snapshot, placement: .followCard, size: .small)
    XCTAssertNil(small.chartCaption)
    let medium = SummaryWidgetModel.content(snapshot, placement: .followCard, size: .medium)
    XCTAssertNil(medium.formCaption)
  }

  func testAnHrvChartIsNamedByItsHeroAndCaptionedWithItsSpan() throws {
    let snapshot = try self.snapshot("demo")
    let content = SummaryWidgetModel.content(
      snapshot, placement: SummaryPlacement(hero: "hrv"), size: .medium)
    XCTAssertEqual(content.chart, .hrv)
    XCTAssertEqual(content.chartCaption, ChartCaption(series: [], span: "30 days"))
  }

  func testNoChartHasNoCaption() throws {
    let snapshot = try self.snapshot("demo")
    let content = SummaryWidgetModel.content(
      snapshot, placement: SummaryPlacement(sparkline: false), size: .medium)
    XCTAssertEqual(content.chart, .none)
    XCTAssertNil(content.chartCaption)
  }
}
