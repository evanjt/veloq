// Which screenshot set the gallery opens on. iPadOS in desktop mode reports a
// Mac user agent, so a Mac that also reports touch points is an iPad.
function pickPlatform(userAgent, maxTouchPoints) {
  const ua = userAgent || "";
  if (/iPad/.test(ua)) return "ipad";
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return "ipad";
  return "android";
}

// The shot's name without its folder or extension, the same in every platform
// set and both themes: screenshots/ipad/dark/05-insights.png is 05-insights.
function stemOf(src) {
  return String(src).split("/").pop().replace(/\.[^.]*$/, "");
}

// Which slide of a set shows the shot the visitor was on. A set that lacks the
// stem keeps the position, clamped to its length.
function slideIndexForStem(stems, stem, fallback) {
  if (!stems.length) return 0;
  const at = stems.indexOf(stem);
  if (at >= 0) return at;
  return Math.max(0, Math.min(fallback, stems.length - 1));
}

if (typeof module !== "undefined") {
  module.exports = {
    pickPlatform: pickPlatform,
    stemOf: stemOf,
    slideIndexForStem: slideIndexForStem,
  };
}
