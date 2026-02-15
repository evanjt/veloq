/**
 * VeloqrsModuleProvider.mm
 *
 * This file provides a runtime registration mechanism for the Veloqrs TurboModule.
 *
 * PROBLEM: expo-modules-autolinking doesn't discover local monorepo modules,
 * so Codegen doesn't generate the provider mapping for our module. The generated
 * RCTModuleProviders.mm uses dispatch_once which caches the providers dictionary
 * on first access, making runtime swizzling ineffective.
 *
 * SOLUTION: Instead of swizzling RCTModuleProviders (which has timing issues due
 * to dispatch_once caching), we provide Veloqrs directly through the class lookup
 * mechanism that RCTTurboModuleManager uses as a fallback.
 *
 * The lookup chain in RCTTurboModuleManager._moduleProviderForName is:
 * 1. Ask delegate for getModuleProvider:
 * 2. If not found, call _provideObjCModule:moduleProvider: which uses:
 *    a. _getModuleClassFromName: → NSClassFromString("Veloqrs")
 *    b. Fallback to RCTGetModuleClasses() iteration
 *
 * Our approach: Ensure the Veloqrs class is properly registered so NSClassFromString
 * can find it, AND implement getTurboModule: so the TurboModule system can use it.
 */

#import <Foundation/Foundation.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <ReactCommon/RCTTurboModule.h>
#import <React/RCTBridgeModule.h>
#import "Veloqrs.h"

/**
 * Force the Veloqrs class to be loaded and registered.
 *
 * In some build configurations, the linker may strip "unused" classes.
 * By referencing the class in a constructor function, we ensure:
 * 1. The class is linked into the binary
 * 2. The class's +load method runs (which calls RCT_EXPORT_MODULE)
 * 3. NSClassFromString("Veloqrs") can find it
 */
__attribute__((constructor))
static void VeloqrsModuleProviderInit(void) {
    // Force the Veloqrs class to be loaded by referencing it
    // This ensures the linker doesn't strip it as "unused"
    Class veloqrsClass = [Veloqrs class];

#ifdef DEBUG
    fprintf(stderr, "[VELOQRS] VeloqrsModuleProviderInit constructor called\n");

    if (veloqrsClass) {
        fprintf(stderr, "[VELOQRS] ✓ Veloqrs class loaded at %p\n", veloqrsClass);

        if ([veloqrsClass instancesRespondToSelector:@selector(getTurboModule:)]) {
            fprintf(stderr, "[VELOQRS] ✓ Veloqrs implements getTurboModule:\n");
        } else {
            fprintf(stderr, "[VELOQRS] ⚠ Veloqrs does NOT implement getTurboModule:\n");
        }

        SEL moduleNameSel = @selector(moduleName);
        if ([veloqrsClass respondsToSelector:moduleNameSel]) {
            NSString *name = [veloqrsClass performSelector:moduleNameSel];
            fprintf(stderr, "[VELOQRS] ✓ Module name is '%s'\n", [name UTF8String]);
        }

        Class foundClass = NSClassFromString(@"Veloqrs");
        if (foundClass) {
            fprintf(stderr, "[VELOQRS] ✓ NSClassFromString(@\"Veloqrs\") found class at %p\n", foundClass);
        } else {
            fprintf(stderr, "[VELOQRS] ⚠ NSClassFromString(@\"Veloqrs\") returned nil!\n");
        }
    } else {
        fprintf(stderr, "[VELOQRS] ⚠ Failed to load Veloqrs class!\n");
    }
#else
    (void)veloqrsClass;
#endif
}

#endif // RCT_NEW_ARCH_ENABLED
