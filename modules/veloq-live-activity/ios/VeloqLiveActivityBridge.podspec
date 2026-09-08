require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'VeloqLiveActivityBridge'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  # ActivityKit is 16.1, and the app already builds at 16.4.
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/evanjt/veloq.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit', 'AppIntents'

  # RecordingActivityAttributes.swift and RecordingActivityIntents.swift are copied
  # in from widget/ios by with-ios-widget.js at prebuild, so the app and the widget
  # extension compile one definition rather than two that drift.
  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
