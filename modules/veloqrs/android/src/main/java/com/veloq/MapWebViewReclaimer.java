package com.veloq;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.function.Consumer;

final class MapWebViewReclaimer<T> {
  private final int releaseLevel;
  private final Consumer<Runnable> post;
  private final Consumer<T> release;
  private final Set<T> mounted = Collections.newSetFromMap(new WeakHashMap<>());

  /**
   * From API 34 the system sends no trim level above TRIM_MEMORY_BACKGROUND (40), so that is
   * the last warning before the low-memory killer; below 34 it is TRIM_MEMORY_MODERATE (60).
   * TRIM_MEMORY_UI_HIDDEN (20) never releases, so switching apps does not reload the map.
   */
  static int releaseLevel(int sdkInt) {
    return sdkInt >= 34 ? 40 : 60;
  }

  MapWebViewReclaimer(int sdkInt, Consumer<Runnable> post, Consumer<T> release) {
    this.releaseLevel = releaseLevel(sdkInt);
    this.post = post;
    this.release = release;
  }

  void add(T view) {
    mounted.add(view);
  }

  void remove(T view) {
    mounted.remove(view);
  }

  boolean empty() {
    return mounted.isEmpty();
  }

  void onTrimMemory(int level) {
    if (level < releaseLevel) return;
    post.accept(() -> {
      for (T view : new ArrayList<>(mounted)) release.accept(view);
    });
  }
}
