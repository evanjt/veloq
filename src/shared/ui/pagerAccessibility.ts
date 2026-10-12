/**
 * Accessibility props for one page of a pager that lays its pages side by side
 * and translates the row. A page out of view is still in the accessibility tree
 * unless it says otherwise, so a screen reader would walk from the page on
 * screen into its neighbours. Only the active page is exposed; the others stay
 * mounted, keeping their state, and are hidden from VoiceOver and TalkBack.
 */
export function pageAccessibility(index: number, activeIndex: number) {
  const active = index === activeIndex;
  return {
    accessibilityElementsHidden: !active,
    importantForAccessibility: active ? ('auto' as const) : ('no-hide-descendants' as const),
  };
}
