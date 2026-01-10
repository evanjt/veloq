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
  generated_swift_path = File.join(__dir__, 'Generated', 'tracematch.swift')
  generated_modulemap_path = File.join(__dir__, 'Generated', 'tracematchFFI.modulemap')

  # REQUIRED: Rust library must be downloaded before pod install
  # Download with: npm run rust:download
  unless ENV['SKIP_RUST_CHECK'] == '1'
    missing_files = []
    missing_files << "XCFramework: #{xcframework_path}" unless File.exist?(xcframework_path)
    missing_files << "Swift bindings: #{generated_swift_path}" unless File.exist?(generated_swift_path)
    missing_files << "Module map: #{generated_modulemap_path}" unless File.exist?(generated_modulemap_path)

    unless missing_files.empty?
      raise <<-ERROR

================================================================================
ERROR: Rust library artifacts not found!

The RouteMatcherNative module requires the compiled Rust library.
Missing files:
  #{missing_files.join("\n  ")}

To download the Rust library:
  npm run rust:download

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
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/Frameworks"'
    # Note: HEADER_SEARCH_PATHS and SWIFT_INCLUDE_PATHS removed to avoid
    # module redefinition conflict with XCFramework's internal modulemap
  }
end
