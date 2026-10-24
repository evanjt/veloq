// Which screenshot set the gallery opens on. iPadOS in desktop mode reports a
// Mac user agent, so a Mac that also reports touch points is an iPad.
function pickPlatform(userAgent, maxTouchPoints) {
  const ua = userAgent || "";
  if (/iPad/.test(ua)) return "ipad";
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return "ipad";
  return "android";
}

if (typeof module !== "undefined") module.exports = { pickPlatform: pickPlatform };
