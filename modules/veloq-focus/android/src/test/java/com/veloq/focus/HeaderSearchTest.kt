package com.veloq.focus

import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * Scenario: a screen whose header is laid over its content, so the header's bar is added to the
 * screen's frame after the content and a screen reader reaches Back only after the whole page.
 *
 * Expected behaviour: from anywhere in the content, the search finds the bar of that screen's own
 * header, and never the bar of another screen in the stack.
 */
class HeaderSearchTest {
  private class Node(val name: String, vararg kids: Node) {
    var parent: Node? = null
    val children = kids.toList()

    init {
      children.forEach { it.parent = this }
    }
  }

  private fun find(from: Node): Node? =
    HeaderSearch.find(
      from,
      parentOf = { it.parent },
      childrenOf = { it.children },
      isHeader = { it.name.startsWith("bar") },
      isFrame = { it.name.startsWith("frame") },
    )

  private fun screen(id: String, content: Node, header: Boolean = true): Node {
    val page = Node("page-$id", content)
    return if (header) {
      Node("frame-$id", page, Node("appbar-$id", Node("bar-$id", Node("title-$id"))))
    } else {
      Node("frame-$id", page)
    }
  }

  @Test
  fun content_deep_in_a_screen_finds_the_bar_added_after_it() {
    val content = Node("content", Node("hero"))
    val frame = screen("detail", content)

    val bar = find(content)

    assertSame(frame.children[1].children[0], bar)
  }

  @Test
  fun the_bar_is_found_from_the_content_root_itself() {
    val content = Node("content")
    val frame = screen("detail", content)

    assertSame(frame.children[1].children[0], find(content))
  }

  @Test
  fun a_screen_with_no_header_finds_none_even_when_the_screen_beneath_has_one() {
    val content = Node("content")
    val beneath = screen("list", Node("list-content"))
    val top = screen("detail", content, header = false)
    Node("stack", beneath, top)

    assertNull(find(content))
  }

  @Test
  fun the_screen_above_finds_its_own_bar_rather_than_the_one_beneath() {
    val content = Node("content")
    val beneath = screen("list", Node("list-content"))
    val top = screen("detail", content)
    Node("stack", beneath, top)

    assertSame(top.children[1].children[0], find(content))
  }

  @Test
  fun content_outside_any_screen_frame_finds_none() {
    val content = Node("content")
    Node("root", Node("page", content), Node("appbar", Node("bar-stray")))

    assertNull(find(content))
  }

  @Test
  fun a_bar_inside_the_content_is_not_the_header() {
    val content = Node("content", Node("bar-inline"))
    screen("detail", content, header = false)

    assertNull(find(content))
  }

  private fun lastStop(header: Node): Node =
    HeaderSearch.lastStop(header, childrenOf = { it.children }) { it.name.startsWith("stop") }

  @Test
  fun the_content_follows_the_title_rather_than_the_back_control() {
    val header = Node("bar", Node("stop-up"), Node("stop-title"))

    assertSame(header.children[1], lastStop(header))
  }

  @Test
  fun before_the_title_arrives_the_content_follows_the_back_control() {
    val header = Node("bar", Node("stop-up"), Node("spacer"))

    assertSame(header.children[0], lastStop(header))
  }

  @Test
  fun a_stop_nested_in_the_header_counts_in_tree_order() {
    val header = Node("bar", Node("stop-up"), Node("items", Node("stop-share"), Node("spacer")))

    assertSame(header.children[1].children[0], lastStop(header))
  }

  @Test
  fun a_header_with_no_stop_in_it_is_its_own_anchor() {
    val header = Node("bar", Node("spacer"))

    assertSame(header, lastStop(header))
  }
}
