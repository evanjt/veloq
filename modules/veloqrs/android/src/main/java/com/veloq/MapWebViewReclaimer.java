package com.veloq;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.function.Consumer;

final class MapWebViewReclaimer<T> {
  private final Consumer<Runnable> post;
  private final Consumer<T> release;
  private final Set<T> mounted = Collections.newSetFromMap(new WeakHashMap<>());

  MapWebViewReclaimer(Consumer<Runnable> post, Consumer<T> release) {
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
    if (level < 60) return;
    post.accept(() -> {
      for (T view : new ArrayList<>(mounted)) release.accept(view);
    });
  }
}
