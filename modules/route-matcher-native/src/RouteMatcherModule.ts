import { requireNativeModule } from 'expo-modules-core';

// This loads the native module defined in the iOS/Android code
const RouteMatcherModule = requireNativeModule('RouteMatcher');

export default RouteMatcherModule;
