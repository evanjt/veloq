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
    /// "recording" or "paused". A string rather than an enum so an unknown value from a
    /// newer build reads as recording instead of failing to decode the whole card.
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
    /// Milliseconds since the epoch after which the card is stale. Every push moves it
    /// on, so only a process that has stopped pushing, one the system killed mid-ride,
    /// lets the card reach it.
    let staleAt: Double?

    struct Trace: Codable, Hashable {
      /// Normalised 0..1 pairs, y growing downward like screen pixels.
      let points: [[Double]]
      let aspect: Double
    }

    var isPaused: Bool { status == "paused" }

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
