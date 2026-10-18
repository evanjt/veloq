package com.veloq;

/**
 * The revision a map page's HTML names in its head. Two pages with one revision run the same
 * document, so a held page can take a mount's map without loading that mount's HTML.
 *
 * <p>Agreed with `PAGE_REVISION_META` in `htmlBuilders/shared.ts`.
 */
final class PageRevision {
  static final String META = "<meta name=\"veloq-page-revision\" content=\"";

  private PageRevision() {}

  static String of(String html) {
    if (html == null) return null;
    int start = html.indexOf(META);
    if (start < 0) return null;
    start += META.length();
    int end = html.indexOf('"', start);
    return end < 0 ? null : html.substring(start, end);
  }

  /** True when a held page of `held` can stand in for a load of `incoming`. */
  static boolean adopts(String held, String incoming) {
    return held != null && held.equals(incoming);
  }
}
