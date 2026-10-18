package com.veloq;

import java.util.Collections;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.function.Consumer;

/**
 * Keeps the last dropped map view, with its page, for the next mount on the same surface.
 *
 * <p>One view at most: a held page costs a renderer's worth of memory, so a second drop while
 * one is held is destroyed as before. The held view goes at the trim level where the mounted
 * maps release theirs, when the host is destroyed, and when its renderer dies, since a view
 * whose renderer died must not be used again.
 */
final class MapWebViewSlot<V, C> {
  static final class Held<V> {
    final V view;
    final String revision;

    Held(V view, String revision) {
      this.view = view;
      this.revision = revision;
    }
  }

  private final int releaseLevel;
  private final Consumer<V> destroy;
  private final Set<V> rendererGone = Collections.newSetFromMap(new WeakHashMap<>());
  private V view;
  private C surface;
  private String revision;

  MapWebViewSlot(int sdkInt, Consumer<V> destroy) {
    this.releaseLevel = MapWebViewReclaimer.releaseLevel(sdkInt);
    this.destroy = destroy;
  }

  /**
   * True when the slot keeps `dropped`, which the caller then must not destroy. A page with no
   * revision is not one a mount can take over.
   */
  boolean offer(V dropped, C droppedSurface, String droppedRevision) {
    if (view != null || droppedRevision == null || rendererGone.contains(dropped)) return false;
    view = dropped;
    surface = droppedSurface;
    revision = droppedRevision;
    return true;
  }

  /** The held view when it was made on `mountSurface`, which empties the slot. */
  Held<V> take(C mountSurface) {
    if (view == null || surface != mountSurface) return null;
    Held<V> held = new Held<>(view, revision);
    clear();
    return held;
  }

  boolean holding() {
    return view != null;
  }

  boolean holds(V candidate) {
    return view != null && view == candidate;
  }

  void rendererGone(V gone) {
    rendererGone.add(gone);
    if (holds(gone)) evict();
  }

  void onTrimMemory(int level) {
    if (level >= releaseLevel) evict();
  }

  void onHostDestroy() {
    evict();
  }

  private void evict() {
    if (view == null) return;
    V evicted = view;
    clear();
    destroy.accept(evicted);
  }

  private void clear() {
    view = null;
    surface = null;
    revision = null;
  }
}
