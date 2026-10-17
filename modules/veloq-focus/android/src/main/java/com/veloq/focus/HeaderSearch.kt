package com.veloq.focus

/**
 * Finds the bar of the header that belongs to the screen holding a view.
 *
 * A screen's frame holds its content and its header's bar side by side. The search climbs from the
 * view to the nearest frame and looks through what sits beside each step on the way, so it reaches
 * that screen's bar and stops before the frames of the other screens in the stack. A view in no
 * frame, or in a frame with no bar, has none. The tree is reached through the functions given, so
 * the rule holds for any tree and is tested without one.
 */
internal object HeaderSearch {
  fun <T : Any> find(
    from: T,
    parentOf: (T) -> T?,
    childrenOf: (T) -> List<T>,
    isHeader: (T) -> Boolean,
    isFrame: (T) -> Boolean,
  ): T? {
    val path = mutableListOf(from)
    var parent = parentOf(from)
    while (parent != null && !isFrame(parent)) {
      path.add(parent)
      parent = parentOf(parent)
    }
    if (parent == null) return null
    path.add(parent)

    for (i in 1 until path.size) {
      val step = path[i - 1]
      for (child in childrenOf(path[i])) {
        if (child === step) continue
        firstHeader(child, childrenOf, isHeader)?.let { return it }
      }
    }
    return null
  }

  /**
   * The last stop a screen reader makes inside the header, in tree order, which is where the
   * content's walk begins after: the title once it has one, else the back control. The header
   * itself is the fallback when nothing in it is a stop.
   */
  fun <T : Any> lastStop(header: T, childrenOf: (T) -> List<T>, isStop: (T) -> Boolean): T =
    lastStopIn(header, childrenOf, isStop) ?: header

  private fun <T : Any> lastStopIn(node: T, childrenOf: (T) -> List<T>, isStop: (T) -> Boolean): T? {
    for (child in childrenOf(node).asReversed()) {
      lastStopIn(child, childrenOf, isStop)?.let { return it }
    }
    return if (isStop(node)) node else null
  }

  private fun <T : Any> firstHeader(node: T, childrenOf: (T) -> List<T>, isHeader: (T) -> Boolean): T? {
    if (isHeader(node)) return node
    for (child in childrenOf(node)) firstHeader(child, childrenOf, isHeader)?.let { return it }
    return null
  }
}
