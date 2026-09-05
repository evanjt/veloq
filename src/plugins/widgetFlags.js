/**
 * The one flag that decides whether Quick-Record ships, read by both widget
 * plugins. Android drops the receiver and writes a bool the Dashboard layout
 * reads; iOS omits the widget from both bundles, which is what keeps it out of
 * the gallery. Flip to true when the record surface is ready and both platforms
 * follow.
 */
const INCLUDE_RECORD_WIDGET = false;

module.exports = { INCLUDE_RECORD_WIDGET };
