Pod::Spec.new do |s|
  s.name           = 'VoltShield'
  s.version        = '1.0.0'
  s.summary        = 'Local Expo module for Volt shield helpers'
  s.description    = 'Platform helpers for Volt shield permissions and app blocking integrations.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
