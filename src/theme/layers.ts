/**
 * The layers a view is stacked at, and no others.
 *
 * React Native orders `zIndex` only among the children of one parent, so a
 * value says nothing outside its parent: a screen's `mapOverlay` cannot rise
 * over the root's `tabBar`, because the Stack that holds the screen sits under
 * the tab bar at the root. Each rung therefore belongs to the parent that hosts
 * it:
 *
 * - `base`, `raised` and `sticky` order the children of one card, row or
 *   screen: an overlay that takes the press is `raised`, a header that stays
 *   put while its content scrolls is `sticky`.
 * - `mapOverlay` is a map's own chrome over its surface: the buttons, the key,
 *   the credit and a popup, inside the map's container.
 * - `overlay` covers a whole view inside its own parent, as section creation
 *   covers its map and the loupe covers the body diagram.
 * - The root layout hosts `floating`, `tabBar`, `banner`, `toast` and
 *   `overlay`, above the Stack and every screen in it.
 */
export const layers = {
  base: 0,
  raised: 1,
  sticky: 10,
  mapOverlay: 100,
  floating: 200,
  tabBar: 300,
  banner: 400,
  toast: 500,
  overlay: 600,
} as const;

/**
 * Each floating piece's own value inside the floating band, so no two share a
 * layer and none reaches the tab bar. The status pills share one stack at the
 * top and the return pills one at the foot, each taking one layer; the record
 * button floats inside the feed screen.
 */
export const floatingLayers = {
  recordButton: layers.floating,
  statusPills: layers.floating + 1,
  returnPills: layers.floating + 2,
} as const;
