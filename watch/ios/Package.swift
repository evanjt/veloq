// swift-tools-version:5.9
import PackageDescription

// The pure parts of the watch target, built as a package so their tests run
// without a watch simulator.
let package = Package(
    name: "VeloqWatchPure",
    platforms: [.macOS(.v13)],
    targets: [
        .target(
            name: "VeloqWatchPure",
            path: "VeloqWatch",
            exclude: [
                "Assets.xcassets", "Info.plist", "VeloqWatchApp.swift", "WatchSession.swift",
                "WatchStatusView.swift", "GuideLocation.swift", "GuideView.swift", "GuideMapView.swift",
            ]
        ),
        .testTarget(name: "VeloqWatchPureTests", dependencies: ["VeloqWatchPure"], path: "tests"),
    ]
)
