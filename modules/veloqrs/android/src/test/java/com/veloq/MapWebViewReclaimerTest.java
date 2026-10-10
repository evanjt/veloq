package com.veloq;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

public class MapWebViewReclaimerTest {
  @Test
  public void test_trim_releases_live_views_while_host_is_paused() {
    List<Runnable> mainQueue = new ArrayList<>();
    List<Object> released = new ArrayList<>();
    AtomicBoolean hostPaused = new AtomicBoolean(true);
    MapWebViewReclaimer<Object> reclaimer =
        new MapWebViewReclaimer<>(33, mainQueue::add, view -> {
          assertTrue(hostPaused.get());
          released.add(view);
        });
    Object first = new Object();
    Object second = new Object();
    Object dropped = new Object();
    reclaimer.add(first);
    reclaimer.add(second);
    reclaimer.add(dropped);
    reclaimer.remove(dropped);

    reclaimer.onTrimMemory(40);
    assertTrue(mainQueue.isEmpty());
    reclaimer.onTrimMemory(60);
    assertEquals(1, mainQueue.size());
    mainQueue.remove(0).run();

    assertEquals(2, released.size());
    assertTrue(released.contains(first));
    assertTrue(released.contains(second));
  }

  @Test
  public void test_background_level_releases_from_api_34_where_no_higher_level_arrives() {
    List<Runnable> mainQueue = new ArrayList<>();
    List<Object> released = new ArrayList<>();
    MapWebViewReclaimer<Object> reclaimer =
        new MapWebViewReclaimer<>(34, mainQueue::add, released::add);
    Object first = new Object();
    Object second = new Object();
    reclaimer.add(first);
    reclaimer.add(second);

    reclaimer.onTrimMemory(20);
    assertTrue(mainQueue.isEmpty());
    reclaimer.onTrimMemory(40);
    assertEquals(1, mainQueue.size());
    mainQueue.remove(0).run();

    assertEquals(2, released.size());
    assertTrue(released.contains(first));
    assertTrue(released.contains(second));
  }

  @Test
  public void test_ui_hidden_never_releases() {
    List<Runnable> mainQueue = new ArrayList<>();
    for (int sdk : new int[] {33, 34, 36}) {
      MapWebViewReclaimer<Object> reclaimer =
          new MapWebViewReclaimer<>(sdk, mainQueue::add, view -> {});
      reclaimer.add(new Object());
      reclaimer.onTrimMemory(20);
    }
    assertTrue(mainQueue.isEmpty());
  }
}
