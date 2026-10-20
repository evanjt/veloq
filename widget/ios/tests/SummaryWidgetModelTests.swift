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

  /// Scenario: the hero is one of fitness, fatigue and form, and the chart beside it draws two of
  /// them without naming either value.
  ///
  /// Expected behaviour: at Large the other two readings stand on the hero's line with their own
  /// labels and values, in the order fitness, fatigue, form, and the supporting row leaves them
  /// out; Medium, whose hero shares its one row with the chart, Small and a hero outside training
  /// load carry none.
  func testATrainingLoadHeroCarriesTheOtherTwoOnItsLineAtLarge() throws {
    let snapshot = try self.snapshot("demo")
    do {
      let content = SummaryWidgetModel.content(snapshot, placement: .followCard, size: .large)
      XCTAssertEqual(content.hero.id, "form")
      XCTAssertEqual(content.trainingLoad.map(\.entry.id), ["fitness", "fatigue"])
      XCTAssertEqual(
        content.trainingLoad.map(\.entry.label),
        [snapshot.display.metricLabels.fitness, snapshot.display.metricLabels.fatigue])
      XCTAssertEqual(content.trainingLoad.last?.entry.colorKey, "fatigue")
      for shown in content.trainingLoad {
        XCTAssertFalse(content.supporting.contains { $0.entry.id == shown.entry.id }, shown.entry.id)
      }
    }
    let fitness = SummaryWidgetModel.content(
      snapshot, placement: SummaryPlacement(hero: "fitness"), size: .large)
    XCTAssertEqual(fitness.trainingLoad.map(\.entry.id), ["fatigue", "form"])
    XCTAssertEqual(fitness.trainingLoad.last?.entry.colorKey, "formZone")
    XCTAssertEqual(fitness.trainingLoad.last?.caption, snapshot.display.formZone)
    XCTAssertNil(fitness.trainingLoad.first?.caption)
    for size in [SummarySize.small, .medium] {
      let content = SummaryWidgetModel.content(snapshot, placement: .followCard, size: size)
      XCTAssertTrue(content.trainingLoad.isEmpty)
    }
    let hrv = SummaryWidgetModel.content(
      snapshot, placement: SummaryPlacement(hero: "hrv"), size: .large)
    XCTAssertTrue(hrv.trainingLoad.isEmpty)
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
    let zone = try XCTUnwrap(snapshot.display.formZone)
    XCTAssertEqual(
      large.formCaption,
      FormChartCaption(title: labels.form, zone: zone, span: "42 days"))
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

  func testMediumAndLargeCarryTheRecordLinkForTheLastSportAndSmallNone() throws {
    let snapshot = try self.snapshot("demo")
    let ride = URL(string: "veloq://record?type=Ride")
    for size in [SummarySize.medium, .large] {
      let content = SummaryWidgetModel.content(snapshot, placement: .followCard, size: size)
      XCTAssertEqual(content.record, ride, "\(size)")
    }
    let small = SummaryWidgetModel.content(snapshot, placement: .followCard, size: .small)
    XCTAssertNil(small.record)
  }

  func testWithNoSportRecordedTheRecordLinkOpensThePicker() throws {
    let snapshot = try self.snapshot("no-wellness")
    let content = SummaryWidgetModel.content(snapshot, placement: .followCard, size: .medium)
    XCTAssertEqual(content.record, RecordDeepLink.picker)
  }
}
