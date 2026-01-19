module.exports = {
  dependency: {
    platforms: {
      ios: {
        podspecPath: "ios/RouteMatcherNative.podspec",
      },
      android: {
        sourceDir: "android",
        packageImportPath: "import com.veloq.VeloqPackage;",
        packageInstance: "new VeloqPackage()",
        libraryName: "Veloq",
        cmakeListsPath: "android/build/generated/source/codegen/jni/CMakeLists.txt",
      },
    },
  },
};
