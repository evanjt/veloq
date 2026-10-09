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
@available(iOS 16.2, *)
struct VeloqRecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: VeloqRecordingAttributes.self) { context in
      RecordingLockScreenView(
        attributes: context.attributes,
        state: context.state,
        isStale: context.isStale
      )
      .activityBackgroundTint(Color.black.opacity(0.55))
      .activitySystemActionForegroundColor(WidgetTheme.Record.foreground)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          RecordingClock(
            state: context.state,
            isStale: context.isStale,
            size: WidgetTheme.TypeScale.metric
          )
          .padding(.leading, WidgetTheme.Layout.gap)
        }
        DynamicIslandExpandedRegion(.trailing) {
          // The control sits with the numbers it acts on. In the bottom region it
          // was diagonally opposite the clock, holding a row open on its own.
          HStack(spacing: WidgetTheme.Layout.gap) {
            VStack(alignment: .trailing, spacing: 2) {
              if context.isStale, let stopped = context.attributes.stoppedLabel {
                Text(stopped)
                  .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
                  .multilineTextAlignment(.trailing)
              } else {
                Text(context.state.distanceLabel)
                  .font(.system(size: WidgetTheme.TypeScale.value, weight: .semibold))
                Text(context.state.speedLabel)
                  .font(.system(size: WidgetTheme.TypeScale.label))
                  .foregroundStyle(.secondary)
              }
            }
            // A pause sent to a process that is gone does nothing, so a stale card
            // offers only the tap that opens the app.
            if !context.isStale {
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
              .frame(height: 40)
          }
        }
      } compactLeading: {
        RecordingGlyph(isPaused: context.state.isPaused, isStale: context.isStale)
      } compactTrailing: {
        RecordingClock(
          state: context.state,
          isStale: context.isStale,
          size: WidgetTheme.TypeScale.label
        )
      } minimal: {
        RecordingGlyph(isPaused: context.state.isPaused, isStale: context.isStale)
      }
      .widgetURL(URL(string: "veloq://record"))
      .keylineTint(WidgetTheme.Record.Light.gradientStart)
    }
  }
}

@available(iOS 16.2, *)
private struct RecordingLockScreenView: View {
  let attributes: VeloqRecordingAttributes
  let state: VeloqRecordingAttributes.ContentState
  let isStale: Bool

  var body: some View {
    HStack(alignment: .center, spacing: WidgetTheme.Layout.padding) {
      VStack(alignment: .leading, spacing: 2) {
        Text((attributes.activityLabel ?? attributes.activityType).uppercased())
          .font(.system(size: WidgetTheme.TypeScale.caption, weight: .semibold))
          .foregroundStyle(.secondary)
        RecordingClock(state: state, isStale: isStale, size: WidgetTheme.TypeScale.hero)
        if isStale, let stopped = attributes.stoppedLabel {
          Text(stopped)
            .font(.system(size: WidgetTheme.TypeScale.label, weight: .semibold))
            .foregroundStyle(WidgetTheme.Record.foreground)
        } else {
          Text("\(state.distanceLabel)  ·  \(state.speedLabel)")
            .font(.system(size: WidgetTheme.TypeScale.label))
            .foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      // Same rule as the island: no trace, no reserved box. Indoor recordings
      // never have one, so the card would carry a 72x56 hole all session.
      if let trace = state.trace, trace.points.count >= 2 {
        RecordingTrace(trace: trace)
          .frame(width: 72, height: 56)
      }
      if !isStale {
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
/// once stale, because no process is recording any more.
@available(iOS 16.2, *)
private struct RecordingClock: View {
  let state: VeloqRecordingAttributes.ContentState
  let isStale: Bool
  let size: CGFloat

  var body: some View {
    Group {
      if state.isPaused || isStale {
        Text(frozenLabel)
      } else {
        Text(timerInterval: state.timerStart...Date.distantFuture, countsDown: false)
      }
    }
    .font(.system(size: size, weight: .semibold).monospacedDigit())
    .foregroundStyle(WidgetTheme.Record.foreground)
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
@available(iOS 16.2, *)
private struct RecordingTrace: View {
  let trace: VeloqRecordingAttributes.ContentState.Trace

  var body: some View {
    if trace.points.count >= 2 {
      RoutePreviewShape(points: trace.points, aspect: trace.aspect)
        .stroke(
          WidgetTheme.Record.Light.gradientStart,
          style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
        )
    }
  }
}

@available(iOS 16.2, *)
private struct RecordingGlyph: View {
  let isPaused: Bool
  let isStale: Bool

  var body: some View {
    if isStale {
      Image(systemName: "exclamationmark.circle.fill")
        .foregroundStyle(WidgetTheme.Light.gold)
    } else {
      Image(systemName: isPaused ? "pause.circle.fill" : "record.circle.fill")
        .foregroundStyle(isPaused ? WidgetTheme.Light.gold : WidgetTheme.Record.Light.gradientStart)
    }
  }
}

/// Pause and resume. iOS 16 has no interactive widget, so it gets the tap target that
/// opens the app instead of a control that would do nothing.
@available(iOS 16.2, *)
private struct RecordingControl: View {
  let state: VeloqRecordingAttributes.ContentState

  var body: some View {
    if #available(iOS 17.0, *) {
      Button(intent: VeloqRecordingControlIntent(action: state.isPaused ? "resume" : "pause")) {
        Image(systemName: state.isPaused ? "play.fill" : "pause.fill")
          .font(.system(size: WidgetTheme.TypeScale.value, weight: .bold))
          .frame(width: 44, height: 44)
      }
      .buttonStyle(.plain)
      .tint(WidgetTheme.Record.Light.gradientStart)
    } else {
      Link(destination: URL(string: "veloq://record")!) {
        Image(systemName: state.isPaused ? "play.fill" : "pause.fill")
          .font(.system(size: WidgetTheme.TypeScale.value, weight: .bold))
          .frame(width: 44, height: 44)
      }
    }
  }
}
