/**
 * VeloqModuleProvider.mm
 *
 * This file provides a runtime registration mechanism for the Veloq TurboModule.
 *
 * PROBLEM: expo-modules-autolinking doesn't discover local monorepo modules,
 * so Codegen doesn't generate the provider mapping for our module. The generated
 * RCTModuleProviders.mm uses dispatch_once which caches the providers dictionary
 * on first access, making runtime swizzling ineffective.
 *
 * SOLUTION: Instead of swizzling RCTModuleProviders (which has timing issues due
 * to dispatch_once caching), we provide Veloq directly through the class lookup
 * mechanism that RCTTurboModuleManager uses as a fallback.
 *
 * The lookup chain in RCTTurboModuleManager._moduleProviderForName is:
 * 1. Ask delegate for getModuleProvider:
 * 2. If not found, call _provideObjCModule:moduleProvider: which uses:
 *    a. _getModuleClassFromName: → NSClassFromString("Veloq")
 *    b. Fallback to RCTGetModuleClasses() iteration
 *
 * Our approach: Ensure the Veloq class is properly registered so NSClassFromString
 * can find it, AND implement getTurboModule: so the TurboModule system can use it.
 */

#import <Foundation/Foundation.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <ReactCommon/RCTTurboModule.h>
#import <React/RCTBridgeModule.h>
#import "Veloq.h"

/**
 * Force the Veloq class to be loaded and registered.
 *
 * In some build configurations, the linker may strip "unused" classes.
 * By referencing the class in a constructor function, we ensure:
 * 1. The class is linked into the binary
 * 2. The class's +load method runs (which calls RCT_EXPORT_MODULE)
 * 3. NSClassFromString("Veloq") can find it
 */
__attribute__((constructor))
static void VeloqModuleProviderInit(void) {
    // This constructor runs VERY early during app launch - before main()
    // Use stderr to ensure output is visible even if NSLog is buffered
    fprintf(stderr, "[VELOQ] VeloqModuleProviderInit constructor called\n");

    // Force the Veloq class to be loaded by referencing it
    // This ensures the linker doesn't strip it as "unused"
    Class veloqClass = [Veloq class];

    if (veloqClass) {
        fprintf(stderr, "[VELOQ] ✓ Veloq class loaded at %p\n", veloqClass);
        NSLog(@"✓ VeloqModuleProvider: Veloq class loaded at %p", veloqClass);

        // Verify the class responds to the TurboModule protocol
        if ([veloqClass instancesRespondToSelector:@selector(getTurboModule:)]) {
            fprintf(stderr, "[VELOQ] ✓ Veloq implements getTurboModule:\n");
            NSLog(@"✓ VeloqModuleProvider: Veloq implements getTurboModule:");
        } else {
            fprintf(stderr, "[VELOQ] ⚠ Veloq does NOT implement getTurboModule:\n");
            NSLog(@"⚠ VeloqModuleProvider: Veloq does NOT implement getTurboModule:");
        }

        // Verify RCT_EXPORT_MODULE registered it
        SEL moduleNameSel = @selector(moduleName);
        if ([veloqClass respondsToSelector:moduleNameSel]) {
            NSString *name = [veloqClass performSelector:moduleNameSel];
            fprintf(stderr, "[VELOQ] ✓ Module name is '%s'\n", [name UTF8String]);
            NSLog(@"✓ VeloqModuleProvider: Module name is '%@'", name);
        }

        // Check if NSClassFromString can find it (this is what RCTTurboModuleManager uses)
        Class foundClass = NSClassFromString(@"Veloq");
        if (foundClass) {
            fprintf(stderr, "[VELOQ] ✓ NSClassFromString(@\"Veloq\") found class at %p\n", foundClass);
        } else {
            fprintf(stderr, "[VELOQ] ⚠ NSClassFromString(@\"Veloq\") returned nil!\n");
        }
    } else {
        fprintf(stderr, "[VELOQ] ⚠ Failed to load Veloq class!\n");
        NSLog(@"⚠ VeloqModuleProvider: Failed to load Veloq class!");
    }
}

#endif // RCT_NEW_ARCH_ENABLED
