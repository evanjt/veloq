require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'RouteMatcherNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platform       = :ios, '14.0'
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Paths to Rust artifacts
  xcframework_path = File.join(__dir__, 'Frameworks', 'RouteMatcherFFI.xcframework')
  generated_swift_path = File.join(__dir__, 'Generated', 'route_matcher.swift')

  # REQUIRED: Rust library must be built before pod install
  # Build with: npm run build:rust:ios
  unless File.exist?(xcframework_path)
    # Allow CI to skip this check with environment variable
    unless ENV['SKIP_RUST_CHECK'] == '1'
      raise <<-ERROR

================================================================================
ERROR: Rust library not found!

The RouteMatcherNative module requires the compiled Rust library.
The XCFramework was not found at:
  #{xcframework_path}

To build the Rust library:
  1. Install Rust iOS targets:
     rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

  2. Build and install:
     npm run build:rust:ios

Then run 'pod install' again.
================================================================================
      ERROR
    end
  end

  # Swift source files - module implementation + UniFFI-generated bindings
  s.source_files = [
    "RouteMatcherModule.swift",
    "Generated/*.swift"
  ]

  # Rust XCFramework
  s.vendored_frameworks = 'Frameworks/RouteMatcherFFI.xcframework'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    # Search paths for the framework
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/Frameworks"',
    # Header search paths for UniFFI-generated headers
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/Generated"',
    # Swift module search path
    'SWIFT_INCLUDE_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/Generated"'
  }
end
