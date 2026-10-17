package com.veloq.focus

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VeloqFocusModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VeloqFocus")

    View(KeyboardFocusBlockView::class) {}

    View(ReadAfterHeaderView::class) {}
  }
}
