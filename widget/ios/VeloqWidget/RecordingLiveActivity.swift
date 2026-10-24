import ActivityKit
import SwiftUI
import WidgetKit

/// Lock-screen and Dynamic Island card for a recording in flight.
///
/// The card renders only what the app pushes. Two things it does compute, because
/// pushing them would be wrong: the clock, which runs from `timerStart` so it keeps
/// counting while the app is suspended, and the trace, which is drawn from normalised
/// points so no basemap or tile is involved.
///
/// Every push moves the card's stale date on, so a card goes stale only once the
/// process has stopped pushing. Then the clock freezes at the last push and the card
/// says the recording stopped, because a clock that keeps counting after the system
/// killed the app tells the rider a dead recording is live.
///
/// A stopped ride ends the card on a final state rather than removing it, so a rider
/// who pockets the phone at the stop still sees the totals and that the ride was kept.
/// That card has no control and its stale date is its dismissal, so it never reads
/// as a stopped recording.
struct VeloqRecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: VeloqRecordingAttributes.self) { context in
      RecordingLockScreenView(
        attributes: context.attributes,
        state: context.state,
        isStale: context.isStale
      )
      .activityBackgroundTint(RecordingCardStyle.tint)
      .activitySystemActionForegroundColor(WidgetTheme.Record.foreground)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          RecordingClock(
            state: context.state,
            isStale: context.isStale,
            step: .metric
          )
          .padding(.leading, WidgetTheme.Layout.gap)
        }
        DynamicIslandExpandedRegion(.trailing) {
          // The control sits with the numbers it acts on. In the bottom region it
          // was diagonally opposite the clock, holding a row open on its own.
          HStack(spacing: WidgetTheme.Layout.gap) {
            VStack(alignment: .trailing, spacing: 2) {
              if !context.state.isEnded, context.isStale,
                let stopped = context.attributes.stoppedLabel
              {
                Text(stopped)
                  .widgetFont(.label, weight: .semibold)
                  .multilineTextAlignment(.trailing)
              } else {
                Text(context.state.distanceLabel)
                  .widgetFont(.value, weight: .semibold)
                  .accessibilityLabel(Text("Distance"))
                  .accessibilityValue(Text(verbatim: context.state.distanceLabel))
                Text(context.state.speedLabel)
                  .widgetFont(.label)
                  .foregroundStyle(RecordingCardStyle.secondaryText)
              }
            }
            // A pause sent to a process that is gone does nothing, so a stale or ended
            // card offers only the tap that opens the app.
            if !context.isStale && !context.state.isEnded {
              RecordingControl(state: context.state)
            }
          }
          .padding(.trailing, WidgetTheme.Layout.gap)
        }
        DynamicIslandExpandedRegion(.bottom) {
          // Only when there is a shape to draw. An indoor ride never has one, and
          // a GPS ride has none until its first fixes land, so an unconditional
          // region is a band of empty black for the whole session or the worst
          // part of it.
          if let trace = context.state.trace, trace.points.count >= 2 {
            RecordingTrace(trace: trace)
              .unspoken()
              .frame(height: 40)
          }
        }
      } compactLeading: {
        RecordingGlyph(
          state: context.state, isStale: context.isStale,
          stoppedLabel: context.attributes.stoppedLabel)
      } compactTrailing: {
        RecordingClock(
          state: context.state,
          isStale: context.isStale,
          step: .label,
          maxWidth: RecordingCardStyle.compactClockWidth
        )
      } minimal: {
        RecordingGlyph(
          state: context.state, isStale: context.isStale,
          stoppedLabel: context.attributes.stoppedLabel)
      }
      .widgetURL(URL(string: "veloq://record"))
      // The island is always drawn on black, whatever the system scheme, so it
      // takes the dark scheme's record tone.
      .keylineTint(WidgetTheme.Record.Dark.accent)
    }
  }
}

private struct RecordingLockScreenView: View {
  let attributes: VeloqRecordingAttributes
  let state: VeloqRecordingAttributes.ContentState
  let isStale: Bool

  var body: some View {
    HStack(alignment: .center, spacing: WidgetTheme.Layout.padding) {
      VStack(alignment: .leading, spacing: 2) {
        Text((attributes.activityLabel ?? attributes.activityType).uppercased())
          .widgetFont(.caption, weight: .semibold)
          .foregroundStyle(RecordingCardStyle.secondaryText)
        RecordingClock(state: state, isStale: isStale, step: .hero)
        if !state.isEnded, isStale, let stopped = attributes.stoppedLabel {
          Text(stopped)
            .widgetFont(.label, weight: .semibold)
            .foregroundStyle(WidgetTheme.Record.foreground)
        } else {
          Text("\(state.distanceLabel)  ·  \(state.speedLabel)")
            .widgetFont(.label)
            .foregroundStyle(RecordingCardStyle.secondaryText)
            .accessibilityLabel(Text("Distance"))
            .accessibilityValue(Text(verbatim: "\(state.distanceLabel), \(state.speedLabel)"))
          if state.isEnded, let ended = state.endedLabel {
            Text(ended)
              .widgetFont(.label, weight: .semibold)
              .foregroundStyle(WidgetTheme.Record.foreground)
          }
        }
      }
      Spacer(minLength: 0)
      // Same rule as the island: no trace, no reserved box. Indoor recordings
      // never have one, so the card would carry a 72x56 hole all session.
      if let trace = state.trace, trace.points.count >= 2 {
        RecordingTrace(trace: trace)
          .unspoken()
          .frame(width: 72, height: 56)
      }
      if !isStale && !state.isEnded {
        RecordingControl(state: state)
      }
    }
    .padding(WidgetTheme.Layout.padding)
    .widgetURL(URL(string: "veloq://record"))
  }
}

/// The elapsed clock. `Text(timerInterval:)` while recording, because a card whose
/// clock is pushed stops the moment the process suspends; a frozen string while
/// paused, because a timer that keeps running through a pause is simply wrong, and
/// once ended or stale, because no process is recording any more.
private struct RecordingClock: View {
  let state: VeloqRecordingAttributes.ContentState
  let isStale: Bool
  let step: WidgetTheme.TypeStep
  /// The frame's width at the step's default size, which grows with the clock.
  let maxWidth: CGFloat?
  @ScaledMetric private var scaled: CGFloat
  @Environment(\.legibilityWeight) private var legibility

  init(
    state: VeloqRecordingAttributes.ContentState, isStale: Bool, step: WidgetTheme.TypeStep,
    maxWidth: CGFloat? = nil
  ) {
    self.state = state
    self.isStale = isStale
    self.step = step
    self.maxWidth = maxWidth
    _scaled = ScaledMetric(wrappedValue: step.size, relativeTo: step.style)
  }

  private var size: CGFloat { step.capped(scaled) }

  var body: some View {
    Group {
      if state.isFrozen || isStale {
        Text(frozenLabel)
      } else {
        Text(timerInterval: state.timerStart...Date.distantFuture, countsDown: false)
      }
    }
    .font(RecordingCardStyle.clockFont(size, boldText: legibility == .bold))
    .frame(maxWidth: maxWidth.map { $0 * size / step.size }, alignment: .trailing)
    .foregroundStyle(WidgetTheme.Record.foreground)
    // Read as what it is and then the time, so the number is not a bare clock face.
    .accessibilityElement(children: .combine)
    .accessibilityLabel(Text("Moving time"))
    .accessibilityValue(spokenValue)
  }

  private var spokenValue: Text {
    state.isFrozen || isStale
      ? Text(verbatim: frozenLabel)
      : Text(timerInterval: state.timerStart...Date.distantFuture, countsDown: false)
  }

  private var frozenLabel: String {
    let total = Int(state.frozenElapsedS ?? 0)
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let seconds = total % 60
    return hours > 0
      ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
      : String(format: "%d:%02d", minutes, seconds)
  }
}

/// The ride so far, letterboxed into its frame at the aspect the payload carries so a
/// narrow or flat track is not stretched. Never a polyline of arbitrary size: the payload
/// is capped at 4 KB and the JS side decimates to fit.
private struct RecordingTrace: View {
  let trace: VeloqRecordingAttributes.ContentState.Trace
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    if trace.points.count >= 2 {
      RoutePreviewShape(points: trace.points, aspect: trace.aspect)
        .stroke(
          WidgetTheme.Record.accent(colorScheme),
          style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
        )
    }
  }
}

private struct RecordingGlyph: View {
  let state: VeloqRecordingAttributes.ContentState
  let isStale: Bool
  /// What a stale card says, from the app. Nil on a card started by an older build.
  let stoppedLabel: String?
  @Environment(\.colorScheme) private var colorScheme

  private var isPaused: Bool { state.isPaused }

  var body: some View {
    if state.isEnded {
      Image(systemName: "checkmark.circle.fill")
        .foregroundStyle(WidgetTheme.Record.accent(colorScheme))
        .accessibilityLabel(Text(verbatim: state.endedLabel ?? ""))
        .accessibilityHidden(state.endedLabel == nil)
    } else if isStale {
      Image(systemName: "exclamationmark.circle.fill")
        .foregroundStyle(RecordingCardStyle.stale)
        .accessibilityLabel(Text(verbatim: stoppedLabel ?? ""))
        .accessibilityHidden(stoppedLabel == nil)
    } else {
      Image(systemName: isPaused ? "pause.circle.fill" : "record.circle.fill")
        .foregroundStyle(
          isPaused ? RecordingCardStyle.paused : WidgetTheme.Record.accent(colorScheme))
        .accessibilityLabel(isPaused ? Text("Paused") : Text("Recording"))
    }
  }
}

/// Pause and resume. iOS 16 has no interactive widget, so it gets the tap target that
/// opens the app instead of a control that would do nothing.
private struct RecordingControl: View {
  let state: VeloqRecordingAttributes.ContentState
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    if #available(iOS 17.0, *) {
      Button(intent: VeloqRecordingControlIntent(action: state.isPaused ? "resume" : "pause")) {
        Image(systemName: state.isPaused ? "play.fill" : "pause.fill")
          .widgetFont(.value, weight: .bold)
          .frame(width: 44, height: 44)
      }
      .buttonStyle(.plain)
      .tint(WidgetTheme.Record.accent(colorScheme))
      .accessibilityLabel(spokenLabel)
    } else {
      Link(destination: URL(string: "veloq://record")!) {
        Image(systemName: state.isPaused ? "play.fill" : "pause.fill")
          .widgetFont(.value, weight: .bold)
          .frame(width: 44, height: 44)
      }
      .accessibilityLabel(spokenLabel)
    }
  }

  /// The symbol's own name would be read otherwise, which says the glyph and not the action.
  private var spokenLabel: Text {
    state.isPaused ? Text("Resume recording") : Text("Pause recording")
  }
}

/// The card's own colours and clock frame. The card is on one fixed dark tint in both system
/// appearances, so nothing here may follow the scheme: `.secondary` turns dark grey on a dark card
/// in light appearance.
enum RecordingCardStyle {
  /// Over the wallpaper, which shows through it.
  static let tint = Color.black.opacity(0.55)
  /// The sport label and the distance and speed line. Over a white wallpaper the tint composites
  /// to a mid grey, against which even white holds only 4.8:1, so the line takes the foreground
  /// at full strength to clear 4.5:1 and steps down by size and weight, not by fading. White at
  /// 70 % would be 3.2:1.
  static let secondaryText = WidgetTheme.Record.foreground
  /// Gold marks a personal record and nothing else. The island the glyphs sit in is black in
  /// both appearances, so they take the dark palette.
  static let paused = WidgetTheme.Dark.warning
  static let stale = WidgetTheme.Dark.textSecondary
  /// The compact clock's widest reading, a ride past ten hours. A timer text otherwise takes
  /// every point the island offers and pushes it wider than its digits.
  static let compactClockWidth: CGFloat = 56

  /// The clock in the widget face, with figures of one width so the time does not shift as it
  /// ticks.
  static func clockFont(_ size: CGFloat, boldText: Bool = false) -> Font {
    .widget(size, weight: .semibold, boldText: boldText).monospacedDigit()
  }
}
