import CoreText
import Foundation

/// A package has no Info.plist to list the widget face under `UIAppFonts`, so the tests register
/// the files the package carries, once per process. Unregistered, every widget draws the system
/// face and the captures judge a layout no reader sees.
enum BundledFace {
  static let registered: Void = {
    let files = Bundle.module.urls(forResourcesWithExtension: "ttf", subdirectory: "fonts") ?? []
    for file in files {
      CTFontManagerRegisterFontsForURL(file as CFURL, .process, nil)
    }
  }()
}
