package com.veloq.focus

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.appcompat.widget.Toolbar
import androidx.coordinatorlayout.widget.CoordinatorLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * A screen's content root that a screen reader visits after the screen's header.
 *
 * A header laid over its content is added to the screen's frame after the content, so TalkBack
 * walks the whole page before it reaches Back and the title. This view marks itself as traversed
 * after the header's last stop, which puts the header first whatever order the frame adds them in.
 * Android drops an anchor that is not itself a stop, and the toolbar is none, so the anchor is
 * the last stop inside it. The toolbar can be attached after the content and the title appears once
 * the screen's read has its name, so both are looked up again on every layout.
 */
class ReadAfterHeaderView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {
  private var toolbar: Toolbar? = null

  private val onGlobalLayout = ViewTreeObserver.OnGlobalLayoutListener { anchor() }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnGlobalLayoutListener(onGlobalLayout)
    anchor()
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnGlobalLayoutListener(onGlobalLayout)
    toolbar = null
    super.onDetachedFromWindow()
  }

  private fun anchor() {
    val header =
      toolbar?.takeIf { it.isAttachedToWindow }
        ?: HeaderSearch.find<View>(
          this,
          parentOf = { it.parent as? View },
          childrenOf = ::childrenOf,
          isHeader = { it is Toolbar },
          isFrame = { it is CoordinatorLayout },
        ) as Toolbar?
    toolbar = header
    if (header == null) {
      if (accessibilityTraversalAfter != View.NO_ID) accessibilityTraversalAfter = View.NO_ID
      return
    }
    val stop =
      HeaderSearch.lastStop<View>(header, ::childrenOf) {
        it.visibility == View.VISIBLE && it.isImportantForAccessibility
      }
    if (stop.id == View.NO_ID) stop.id = View.generateViewId()
    if (accessibilityTraversalAfter != stop.id) accessibilityTraversalAfter = stop.id
  }

  private fun childrenOf(view: View): List<View> =
    if (view is ViewGroup) List(view.childCount) { view.getChildAt(it) } else emptyList()
}
