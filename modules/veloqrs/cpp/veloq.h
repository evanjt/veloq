#ifndef VELOQ_H
#define VELOQ_H
// Namespace wrapper to bridge veloq:: (expected by Veloq.mm) to veloqrs:: (provided by veloqrs.cpp)
// This exists because ubrn.config.yaml has turboModule.name: "Veloq" but crate name is "veloqrs"

#include "veloqrs.h"

namespace veloq {
  using namespace facebook;

  inline uint8_t installRustCrate(jsi::Runtime &runtime, std::shared_ptr<react::CallInvoker> callInvoker) {
    return veloqrs::installRustCrate(runtime, callInvoker);
  }

  inline uint8_t cleanupRustCrate(jsi::Runtime &runtime) {
    return veloqrs::cleanupRustCrate(runtime);
  }
}

#endif /* VELOQ_H */
