import ActivityKit
import Foundation

/// The Live Activity contract, compiled into both the app and the widget extension.
/// ActivityKit matches a card to its attributes by type name, so the two copies must
/// stay one file: `with-ios-widget.js` copies this into the bridge module at prebuild.
///
/// Everything here decodes from the JSON `contentState.ts` builds. Optional fields
/// decode to nil rather than failing, so a card started by an older build survives an
/// update from a newer one.
struct VeloqRecordingAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "recording", "paused" or "ended". A string rather than an enum so an unknown value
    /// from a newer build reads as recording instead of failing to decode the whole card.
    let status: String
    /// Milliseconds since the epoch the clock counts up from, already net of paused
    /// time. The card runs its own timer from this, so it keeps ticking while the app
    /// is suspended. A pushed elapsed value freezes there instead.
    let timerFrom: Double
    /// Moving seconds when the state was pushed. The card shows it whenever its own
    /// clock must not run: through a pause, and once the card has gone stale.
    let frozenElapsedS: Double?
    let distanceLabel: String
    let speedLabel: String
    let trace: Trace?
    /// The followed route's off-route line, written when the state changes. Nil when the
    /// ride is on its route, follows none, or the card was started by an older build.
    let guidance: String?
    /// The translated line a stopped ride's final card shows. Nil while recording.
    let endedLabel: String?
    /// Milliseconds since the epoch after which the card is stale. Every push moves it
    /// on, so only a process that has stopped pushing, one the system killed mid-ride,
    /// lets the card reach it.
    let staleAt: Double?
    /// "strength" on a strength session's card, nil on a recording's. The strength card carries
    /// none of the recording fields above, so each of them decodes to its empty value.
    let kind: String?
    /// "set" or "rest", on a strength card.
    let phase: String?
    /// The exercise in hand, or the one just finished while resting.
    let exercise: String?
    /// The set after this one. Nil on the last line.
    let nextSet: String?
    /// Milliseconds since the epoch a rest ends at. Nil on a set and on a rest with no length.
    let restEndsAt: Double?

    init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      status = try c.decodeIfPresent(String.self, forKey: .status) ?? "recording"
      timerFrom = try c.decodeIfPresent(Double.self, forKey: .timerFrom) ?? 0
      frozenElapsedS = try c.decodeIfPresent(Double.self, forKey: .frozenElapsedS)
      distanceLabel = try c.decodeIfPresent(String.self, forKey: .distanceLabel) ?? ""
      speedLabel = try c.decodeIfPresent(String.self, forKey: .speedLabel) ?? ""
      trace = try c.decodeIfPresent(Trace.self, forKey: .trace)
      guidance = try c.decodeIfPresent(String.self, forKey: .guidance)
      endedLabel = try c.decodeIfPresent(String.self, forKey: .endedLabel)
      staleAt = try c.decodeIfPresent(Double.self, forKey: .staleAt)
      kind = try c.decodeIfPresent(String.self, forKey: .kind)
      phase = try c.decodeIfPresent(String.self, forKey: .phase)
      exercise = try c.decodeIfPresent(String.self, forKey: .exercise)
      nextSet = try c.decodeIfPresent(String.self, forKey: .nextSet)
      restEndsAt = try c.decodeIfPresent(Double.self, forKey: .restEndsAt)
    }

    struct Trace: Codable, Hashable {
      /// Normalised 0..1 pairs, y growing downward like screen pixels.
      let points: [[Double]]
      let aspect: Double
    }

    var isStrength: Bool { kind == "strength" }

    /// The rest countdown's end, nil when the card is on a set or the rest has no length.
    var restEnd: Date? {
      guard isStrength, phase == "rest", let end = restEndsAt else { return nil }
      return Date(timeIntervalSince1970: end / 1000)
    }

    var isPaused: Bool { status == "paused" }

    /// The final state of a stopped ride: frozen totals, no control, until dismissed.
    var isEnded: Bool { status == "ended" }

    /// Whether the clock shows the pushed moving time rather than running its own.
    var isFrozen: Bool { isPaused || isEnded }

    /// The date `Text(timerInterval:)` counts from.
    var timerStart: Date { Date(timeIntervalSince1970: timerFrom / 1000) }

    /// The date ActivityKit marks the card stale at, handed over on every request and update.
    var staleDate: Date? { staleAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
  }

  /// intervals.icu activity type, e.g. "Ride". Fixed for the life of the card.
  let activityType: String
  /// The translated name the card shows. Nil on a card started by an older build.
  let activityLabel: String?
  /// "cycling", "running" or "walking", so the card can pick a glyph without a table.
  let sportCategory: String
  /// The translated line a stale card shows. Nil on a card started by an older build.
  let stoppedLabel: String?
}
