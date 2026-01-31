// Custom iOS TurboModule header for veloqrs
// This file is preserved by the build system - do not let uniffi-bindgen overwrite it
#ifdef __cplusplus
#import "cpp/veloqrs.h"
#endif

#import <React/RCTBridgeModule.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <ReactCommon/RCTTurboModule.h>

@interface Veloqrs : NSObject <RCTBridgeModule, RCTTurboModule>
#else
@interface Veloqrs : NSObject <RCTBridgeModule>
#endif

@end
