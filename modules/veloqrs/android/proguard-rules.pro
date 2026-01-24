# Veloq Native Module - UniFFI/Rust bindings
# Keep all classes in the veloq package (TurboModule + generated bindings)
-keep class com.veloq.** { *; }

# Keep JNI native method signatures (exact names required by native code)
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep Turbo Module annotations and interfaces
-keep @com.facebook.react.module.annotations.ReactModule class *
-keep interface com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder { *; }
