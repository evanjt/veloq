import SwiftUI
import WidgetKit

// The widget's refresh control on iOS opens the app rather than refreshing in place. A refresh
// in the extension would open the engine there, and the extension already sits at about 18 MB of
// the roughly 30 MB the platform allows a widget, while the engine's open alone adds about 10 MB
// on a real library before the pull and the compose. So the control is a link, it says it opens
// the app, and the app's foreground sync rewrites the snapshot and reloads the timelines.

/// Where the control goes and what it says.
struct WidgetRefreshLink: Equatable {
  let url: URL
  let label: String

  /// The app's root: any foreground starts the sync that rewrites the snapshot.
  static let destination = URL(string: "veloq://")!

  /// The control for a snapshot, or nil where none is drawn: a size iOS gives no links of its
  /// own (the small family takes one tap for the whole widget), no snapshot, an empty library,
  /// the sample library, which a sync does not change, and a snapshot written before it carried
  /// the control's words, since a label of our own would not be in the athlete's language.
  static func link(_ snapshot: WidgetSnapshot?, hasRoom: Bool) -> WidgetRefreshLink? {
    guard
      hasRoom,
      let snapshot,
      !WidgetSnapshot.isEmpty(snapshot),
      snapshot.display.demoLabel == nil,
      let label = snapshot.display.openToRefreshLabel,
      !label.isEmpty
    else { return nil }
    return WidgetRefreshLink(url: destination, label: label)
  }

  /// The platform's minimum touch target.
  static let target: CGFloat = 44
}

/// The age line with the refresh control at its end, where the size has room for one. A column
/// too narrow for both on one line puts the control under the age, which keeps the age whole,
/// or, in a row kept to `oneLine` for a widget with no height for a second line, draws the
/// control as its glyph beside the age.
struct SnapshotAgeRow: View {
  let snapshot: WidgetSnapshot?
  let palette: WidgetPalette
  let hasRoom: Bool
  var oneLine: Bool = false

  var body: some View {
    if let link = WidgetRefreshLink.link(snapshot, hasRoom: hasRoom) {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 4) {
          SnapshotAgeLine(snapshot: snapshot, palette: palette)
          Spacer(minLength: 0)
          RefreshLinkControl(link: link, palette: palette, alignment: .trailing)
        }
        if oneLine {
          HStack(spacing: 4) {
            SnapshotAgeLine(snapshot: snapshot, palette: palette)
            Spacer(minLength: 0)
            RefreshLinkControl(
              link: link, palette: palette, alignment: .trailing, glyphOnly: true)
          }
        } else {
          VStack(alignment: .leading, spacing: 4) {
            SnapshotAgeLine(snapshot: snapshot, palette: palette)
            RefreshLinkControl(link: link, palette: palette, alignment: .leading)
          }
        }
      }
    } else {
      SnapshotAgeLine(snapshot: snapshot, palette: palette)
    }
  }
}

private struct RefreshLinkControl: View {
  let link: WidgetRefreshLink
  let palette: WidgetPalette
  /// The edge the words or the glyph keep inside the target, the row's own edge.
  let alignment: Alignment
  /// Draws the glyph alone, where the row has no room for the words.
  var glyphOnly = false

  private var glyph: some View {
    Image(systemName: "arrow.up.forward.app")
      .font(.system(size: WidgetTheme.TypeScale.caption, weight: .semibold))
      .unspoken()
  }

  var body: some View {
    Link(destination: link.url) {
      // The words where the row has room for them, else the glyph alone; the screen reader
      // hears the words either way.
      ViewThatFits(in: .horizontal) {
        if !glyphOnly {
          HStack(spacing: 3) {
            Text(link.label)
              .measuredText("refresh link")
              .lineLimit(1)
            glyph
          }
        }
        glyph
      }
      .font(.system(size: WidgetTheme.TypeScale.caption, weight: .semibold))
      .foregroundColor(palette.primary)
      .frame(
        minWidth: WidgetRefreshLink.target, minHeight: WidgetRefreshLink.target,
        alignment: alignment)
      .contentShape(Rectangle())
      .spoken("refresh", link.label)
    }
    // The target stays 44 points tall while the row keeps the height of its caption, so no
    // layout gives up a line to the control. The overhang falls in the widget's padding below
    // and over the content above, which opens the app as well.
    .padding(.vertical, -(WidgetRefreshLink.target - WidgetTheme.TypeScale.caption) / 2)
  }
}
