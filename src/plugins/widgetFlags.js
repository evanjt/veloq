/**
 * The one flag that decides whether Quick-Record ships, read by both widget
 * plugins. Android drops the receiver and writes a bool the Dashboard layout
 * reads; iOS omits the widget from both bundles, which is what keeps it out of
 * the gallery.
 *
 * On since 2026-09-08. Q13 asked for it off until recording was wired and tested
 * end to end, and it now is: the session outlives its screen, the Lock Screen and
 * Dynamic Island carry it on iOS, the Android notification carries pause, lap and
 * stop, and stop and the force-stop leak are both fixed. The tap starts the ride
 * rather than opening a picker.
 */
const INCLUDE_RECORD_WIDGET = true;

module.exports = { INCLUDE_RECORD_WIDGET };
