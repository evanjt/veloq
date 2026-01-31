// Custom iOS TurboModule implementation for veloqrs
// This file is preserved by the build system - do not let uniffi-bindgen overwrite it
#import "Veloqrs.h"

#ifdef RCT_NEW_ARCH_ENABLED
#import <React/RCTBridge+Private.h>
#import <ReactCommon/RCTTurboModule.h>
#import <jsi/jsi.h>

namespace facebook::react {

class JSI_EXPORT VeloqrsTurboModule : public TurboModule {
public:
    VeloqrsTurboModule(std::shared_ptr<CallInvoker> jsInvoker)
        : TurboModule("Veloqrs", jsInvoker), jsInvoker_(jsInvoker) {}

    jsi::Value get(jsi::Runtime &rt, const jsi::PropNameID &name) override {
        std::string propName = name.utf8(rt);

        if (propName == "installRustCrate") {
            return jsi::Function::createFromHostFunction(
                rt,
                name,
                0,
                [this](jsi::Runtime &rt,
                       const jsi::Value &thisVal,
                       const jsi::Value *args,
                       size_t count) -> jsi::Value {
                    uint8_t result = veloqrs::installRustCrate(rt, jsInvoker_);
                    return jsi::Value(static_cast<int>(result));
                });
        }

        if (propName == "cleanupRustCrate") {
            return jsi::Function::createFromHostFunction(
                rt,
                name,
                0,
                [](jsi::Runtime &rt,
                   const jsi::Value &thisVal,
                   const jsi::Value *args,
                   size_t count) -> jsi::Value {
                    uint8_t result = veloqrs::cleanupRustCrate(rt);
                    return jsi::Value(static_cast<int>(result));
                });
        }

        return jsi::Value::undefined();
    }

private:
    std::shared_ptr<CallInvoker> jsInvoker_;
};

} // namespace facebook::react
#endif

@implementation Veloqrs
RCT_EXPORT_MODULE()

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::VeloqrsTurboModule>(params.jsInvoker);
}
#endif

@end
