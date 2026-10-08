import AppIntents
import Foundation
import SwiftUI
import WidgetKit
import os

// Measures what the platform lets this extension's process do with the engine:
// opens the database in the App Group container, composes the widget snapshot,
// and appends the memory readings around each step to a file in the container.
// Compiled only while `INCLUDE_MEMORY_PROBE` is on, and the readings are the
// whole output: nothing here is shown to the athlete beyond a button.

/// What the process may still allocate and what it has, in bytes.
struct MemoryReading {
  /// `os_proc_available_memory()`: the headroom before the system ends the process.
  let available: UInt64
  /// The task's `phys_footprint`, the figure the system's limit is checked against.
  let footprint: UInt64
  /// The highest `phys_footprint` the task has reached.
  let footprintPeak: UInt64

  static func now() -> MemoryReading {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(
      MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let status = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    let known = status == KERN_SUCCESS
    return MemoryReading(
      available: UInt64(os_proc_available_memory()),
      footprint: known ? info.phys_footprint : 0,
      footprintPeak: known ? UInt64(info.ledger_phys_footprint_peak) : 0)
  }

  var json: [String: Any] {
    ["available": available, "footprint": footprint, "footprintPeak": footprintPeak]
  }
}

enum MemoryProbe {
  static let fileName = "memory-probe.jsonl"

  /// One run: the credential read, the engine open and the snapshot compose,
  /// each with the readings after it and its wall time. The line is appended
  /// to the file and also returned.
  static func run() -> [String: Any] {
    var line = header()
    line["before"] = MemoryReading.now().json

    let credentialsStart = DispatchTime.now()
    let credentials = VeloqCredentials.read()
    line["credentials"] = [
      "found": credentials != nil,
      "hasAccessToken": credentials?.accessToken != nil,
      "hasApiKey": credentials?.apiKey != nil,
      "ms": milliseconds(since: credentialsStart),
    ]

    guard let database = databasePath() else {
      line["open"] = ["ready": false, "refusal": "the App Group container is not available"]
      return append(line)
    }
    guard let credentials else {
      line["open"] = ["ready": false, "refusal": "the keychain answered nothing"]
      return append(line)
    }

    let openStart = DispatchTime.now()
    let prepared = VeloqPushEngine.prepare(databasePath: database, credentials: credentials)
    var open = MemoryReading.now().json
    open["ready"] = prepared.ready
    open["refusal"] = prepared.refusal ?? NSNull()
    open["ms"] = milliseconds(since: openStart)
    line["open"] = open

    guard prepared.ready else { return append(line) }

    let composeStart = DispatchTime.now()
    let snapshot = VeloqPushEngine.widgetSnapshot()
    var compose = MemoryReading.now().json
    compose["bytes"] = snapshot?.utf8.count ?? NSNull()
    compose["ms"] = milliseconds(since: composeStart)
    line["compose"] = compose
    return append(line)
  }

  /// The keychain read alone, with no engine: what a timeline refresh before
  /// the first unlock after boot can see.
  static func recordKeychainRead() {
    let start = DispatchTime.now()
    let credentials = VeloqCredentials.read()
    var line = header()
    line["kind"] = "keychain"
    line["credentials"] = [
      "found": credentials != nil,
      "hasAccessToken": credentials?.accessToken != nil,
      "hasApiKey": credentials?.apiKey != nil,
      "ms": milliseconds(since: start),
    ]
    _ = append(line)
  }

  private static func header() -> [String: Any] {
    [
      "kind": "run",
      "at": ISO8601DateFormatter().string(from: Date()),
      "bootTime": bootTime(),
      "model": sysctlString("hw.machine"),
      "os": ProcessInfo.processInfo.operatingSystemVersionString,
      "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
    ]
  }

  private static func databasePath() -> String? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.veloq.app")?
      .appendingPathComponent("routes.db").path
  }

  private static func milliseconds(since start: DispatchTime) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
  }

  private static func sysctlString(_ name: String) -> String {
    var size = 0
    sysctlbyname(name, nil, &size, nil, 0)
    var buffer = [CChar](repeating: 0, count: size)
    sysctlbyname(name, &buffer, &size, nil, 0)
    return String(cString: buffer)
  }

  /// When the device last booted, which tells a run before the first unlock
  /// from one after it when read beside the time the athlete unlocked.
  private static func bootTime() -> String {
    var value = timeval()
    var size = MemoryLayout<timeval>.size
    sysctlbyname("kern.boottime", &value, &size, nil, 0)
    return ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: Double(value.tv_sec)))
  }

  private static func append(_ line: [String: Any]) -> [String: Any] {
    guard
      let directory = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group.com.veloq.app"),
      let data = try? JSONSerialization.data(withJSONObject: line, options: [.sortedKeys])
    else { return line }
    let url = directory.appendingPathComponent(fileName)
    let record = data + Data("\n".utf8)
    if let handle = try? FileHandle(forWritingTo: url) {
      defer { try? handle.close() }
      _ = try? handle.seekToEnd()
      try? handle.write(contentsOf: record)
    } else {
      try? record.write(to: url)
    }
    return line
  }
}

@available(iOS 17.0, *)
struct MemoryProbeIntent: AppIntent {
  static var title: LocalizedStringResource = "Measure extension memory"
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult {
    _ = MemoryProbe.run()
    return .result()
  }
}

struct MemoryProbeEntry: TimelineEntry {
  let date: Date
}

/// Reads the keychain on every refresh, so the file shows whether the
/// extension was given a turn before the first unlock after boot and what the
/// keychain answered then.
struct MemoryProbeProvider: TimelineProvider {
  func placeholder(in context: Context) -> MemoryProbeEntry { MemoryProbeEntry(date: Date()) }

  func getSnapshot(in context: Context, completion: @escaping (MemoryProbeEntry) -> Void) {
    completion(MemoryProbeEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<MemoryProbeEntry>) -> Void) {
    MemoryProbe.recordKeychainRead()
    let now = Date()
    completion(Timeline(entries: [MemoryProbeEntry(date: now)], policy: .after(now.addingTimeInterval(900))))
  }
}

@available(iOS 17.0, *)
struct VeloqMemoryProbeWidget: Widget {
  let kind = "VeloqMemoryProbe"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: MemoryProbeProvider()) { _ in
      Button(intent: MemoryProbeIntent()) {
        Text("Measure")
      }
      .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Memory probe")
    .description("Opens the engine in this extension and records the memory it used.")
    .supportedFamilies([.systemSmall])
  }
}
