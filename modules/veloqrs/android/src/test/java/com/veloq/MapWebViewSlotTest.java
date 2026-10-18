package com.veloq;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

public class MapWebViewSlotTest {
  private final List<Object> destroyed = new ArrayList<>();
  private final Object surface = new Object();

  private MapWebViewSlot<Object, Object> slot(int sdkInt) {
    return new MapWebViewSlot<>(sdkInt, destroyed::add);
  }

  @Test
  public void test_a_drop_then_a_create_hands_back_the_same_view_with_its_page() {
    MapWebViewSlot<Object, Object> slot = slot(34);
    Object view = new Object();

    assertTrue(slot.offer(view, surface, "page-a"));
    MapWebViewSlot.Held<Object> held = slot.take(surface);

    assertSame(view, held.view);
    assertEquals("page-a", held.revision);
    assertNull(slot.take(surface));
    assertTrue(destroyed.isEmpty());
  }

  @Test
  public void test_a_second_drop_while_the_slot_is_full_is_left_to_be_destroyed() {
    MapWebViewSlot<Object, Object> slot = slot(34);
    Object first = new Object();
    Object second = new Object();

    assertTrue(slot.offer(first, surface, "page-a"));
    assertFalse(slot.offer(second, surface, "page-a"));

    assertSame(first, slot.take(surface).view);
    assertTrue(destroyed.isEmpty());
  }

  @Test
  public void test_a_view_whose_renderer_died_is_never_held() {
    MapWebViewSlot<Object, Object> slot = slot(34);
    Object view = new Object();

    slot.rendererGone(view);

    assertFalse(slot.offer(view, surface, "page-a"));
    assertNull(slot.take(surface));
  }

  @Test
  public void test_a_renderer_dying_in_the_slot_destroys_the_held_view() {
    MapWebViewSlot<Object, Object> slot = slot(34);
    Object view = new Object();
    slot.offer(view, surface, "page-a");

    slot.rendererGone(view);

    assertEquals(Collections.singletonList(view), destroyed);
    assertNull(slot.take(surface));
  }

  @Test
  public void test_a_page_with_no_revision_or_unfinished_is_never_held() {
    MapWebViewSlot<Object, Object> slot = slot(34);

    assertFalse(slot.offer(new Object(), surface, null));
    assertNull(slot.take(surface));
  }

  @Test
  public void test_trim_at_the_release_level_destroys_the_held_view_and_below_it_does_not() {
    for (int[] levels : new int[][] {{33, 40, 60}, {34, 20, 40}}) {
      destroyed.clear();
      MapWebViewSlot<Object, Object> slot = slot(levels[0]);
      Object view = new Object();
      slot.offer(view, surface, "page-a");

      slot.onTrimMemory(levels[1]);
      assertTrue(destroyed.isEmpty());

      slot.onTrimMemory(levels[2]);
      assertEquals(Collections.singletonList(view), destroyed);
      assertNull(slot.take(surface));
    }
  }

  @Test
  public void test_ui_hidden_keeps_the_held_view() {
    MapWebViewSlot<Object, Object> slot = slot(36);
    slot.offer(new Object(), surface, "page-a");

    slot.onTrimMemory(20);

    assertTrue(destroyed.isEmpty());
    assertTrue(slot.holding());
  }

  @Test
  public void test_host_destroy_empties_the_slot() {
    MapWebViewSlot<Object, Object> slot = slot(34);
    Object view = new Object();
    slot.offer(view, surface, "page-a");

    slot.onHostDestroy();

    assertEquals(Collections.singletonList(view), destroyed);
    assertFalse(slot.holding());
    slot.onHostDestroy();
    assertEquals(1, destroyed.size());
  }

  @Test
  public void test_a_view_from_another_surface_is_not_handed_out() {
    MapWebViewSlot<Object, Object> slot = slot(34);
    Object view = new Object();
    slot.offer(view, surface, "page-a");

    assertNull(slot.take(new Object()));
    assertSame(view, slot.take(surface).view);
  }

  @Test
  public void test_reclaimer_and_slot_release_at_one_level() {
    for (int sdk : new int[] {29, 33, 34, 36}) {
      assertEquals(sdk >= 34 ? 40 : 60, MapWebViewReclaimer.releaseLevel(sdk));
    }
  }

  @Test
  public void test_the_page_revision_is_read_from_the_html_head() {
    String html = "<!DOCTYPE html>\n<html>\n<head>\n  <meta charset=\"utf-8\">\n"
        + "  <meta name=\"veloq-page-revision\" content=\"3f9a01c2\">\n</head><body></body></html>";

    assertEquals("3f9a01c2", PageRevision.of(html));
    assertNull(PageRevision.of("<html><head></head><body></body></html>"));
    assertNull(PageRevision.of(null));
    assertNull(PageRevision.of("<meta name=\"veloq-page-revision\" content=\"unterminated"));
  }

  @Test
  public void test_a_held_page_skips_the_load_only_for_its_own_revision() {
    assertTrue(PageRevision.adopts("3f9a01c2", "3f9a01c2"));
    assertFalse(PageRevision.adopts("3f9a01c2", "77aa0b10"));
    assertFalse(PageRevision.adopts("3f9a01c2", null));
    assertFalse(PageRevision.adopts(null, null));
  }
}
