# Counts the stops a screen reader walks on one screen, from the accessibility
# tree of either platform, and flags the stops that fail WCAG 2.2 AA.
#
#   python3 -I scripts/measure-screen-reader-stops.py [--json] [--list] [--density DPI] [--package ID] <file|->...
#
# An Android file is a `uiautomator dump --compressed` XML. Its bounds are in
# pixels, so pass the screen's density (default 480, the Large_Phone_API_35
# emulator); nodes of another package, the system bars, are left out.
# An iOS file is the XCUITest view hierarchy JSON the Maestro driver serves at
# POST /viewHierarchy, whose frames are already in points. `maestro hierarchy`
# is not enough: it drops the element type, so a button cannot be told from a
# label. A `maestro hierarchy` taken on Android is read too, for a screen where
# `uiautomator` never reaches an idle state; it carries `clickable` but not
# `focusable` or `checkable`, so a control that is only focusable is counted as
# text. `-` reads one tree from stdin. The driver cuts its snapshot at a fixed
# depth, so on a deeply nested screen the elements below it are missing and the
# count is a floor: the depth column says how deep the tree that came back was.
#
# The walk is the linear one a screen reader takes, in tree order. A stop is an
# actionable element, or an element with a name and no stop above it. A stop is
# named by its own label, or on Android by its descendants' text. Flagged:
#   unnamed  an actionable stop with no name (4.1.2)
#   glyph    a stop named by one character, or by no letter or digit: an icon
#            codepoint or a separator (1.1.1)
#   order    a stop drawn wholly above the nearest stop before it on screen
#            whose column it shares, as a back button walked after the content
#            (2.4.3). Content scrolled past the screen's edge, even partly, is
#            not compared, and a stop starting within 120 units of the bottom
#            edge is a bar pinned there, walked last by design, so a tab bar
#            after a long list is not flagged.
#   spacing  a target under 24 units whose 24-unit circle meets another target
#            or another such circle (2.5.8)
#   floor    a target under the platform floor, 48 dp on Android, 44 pt on iOS;
#            the tree carries no hit slop, so a control padded out by one counts
#   offscreen a stop wholly outside the screen, content a swipe reaches that
#            is not on screen
# This is the tree a screen reader reads, not its speech.
import argparse
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET

FLOOR = {"android": 48.0, "ios": 44.0}
SPACING = 24.0
BOTTOM_BAR = 120.0
FLAGS = ("unnamed", "glyph", "order", "spacing", "floor", "offscreen")

# XCUIElement.ElementType values a screen reader treats as a control.
IOS_ACTIONABLE = {
    9,   # button
    10,  # radioButton
    12,  # checkBox
    14,  # popUpButton
    15,  # comboBox
    16,  # menuButton
    17,  # toolbarButton
    20,  # key
    33,  # slider
    39,  # pickerWheel
    40,  # switch
    41,  # toggle
    42,  # link
    45,  # searchField
    49,  # textField
    50,  # secureTextField
    52,  # textView
    54,  # menuItem
    79,  # stepper
    80,  # tab
}
# Subtrees that belong to the system rather than to the screen: the status
# bar, the keyboard, and the scroll indicators UIKit adds to a scroll view.
IOS_SKIPPED = {19, 25, 47}
# The application and its windows carry the app's name and the whole screen's
# frame, and a screen reader never stops on them.
IOS_CONTAINERS = {2, 4}
# The simulator reports a scroll view's indicators as plain elements, so they
# are known by their system label instead. The pattern is the English one.
IOS_SCROLL_INDICATOR = re.compile(r"^(Vertical|Horizontal) scroll bar, \d+ pages?$")


def depth(node):
    return 1 + max((depth(child) for child in node.children), default=0)


class Node:
    def __init__(self, label, text, actionable, rect, children):
        self.label = label
        self.text = text
        self.actionable = actionable
        self.rect = rect
        self.children = children


def android_rect(bounds, scale):
    m = re.match(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", bounds or "")
    if not m:
        return (0.0, 0.0, 0.0, 0.0)
    x1, y1, x2, y2 = (int(v) / scale for v in m.groups())
    return (x1, y1, x2, y2)


def read_android(element, scale, package):
    children = [
        read_android(child, scale, package)
        for child in element
        if child.tag == "node"
        and not (package and child.get("package") and child.get("package") != package)
    ]
    # A scroll container is walked through, not stopped on, while it holds
    # anything; the reader lands on it only when it is empty.
    actionable = not (element.get("scrollable") == "true" and children) and any(
        element.get(key) == "true"
        for key in ("clickable", "long-clickable", "focusable", "checkable")
    )
    return Node(
        label=(element.get("content-desc") or "").strip(),
        text=(element.get("text") or "").strip(),
        actionable=actionable,
        rect=android_rect(element.get("bounds"), scale),
        children=children,
    )


def foreign(attrs, package):
    """A Maestro tree names no package, so the system bars are known by their
    resource id's package prefix instead. The framework's own `android:` ids
    hold the app's root views."""
    rid = attrs.get("resource-id") or ""
    owner = rid.split(":id/")[0] if ":id/" in rid else ""
    return bool(package) and owner not in ("", "android", package)


def read_maestro_android(element, scale, package):
    attrs = element.get("attributes") or {}
    return Node(
        label=(attrs.get("accessibilityText") or "").strip(),
        text=(attrs.get("text") or "").strip(),
        actionable=attrs.get("clickable") == "true",
        rect=android_rect(attrs.get("bounds"), scale),
        children=[
            read_maestro_android(child, scale, package)
            for child in element.get("children") or []
            if not foreign(child.get("attributes") or {}, package)
        ],
    )


def read_ios(element):
    frame = element.get("frame") or {}
    x, y = float(frame.get("X", 0)), float(frame.get("Y", 0))
    w, h = float(frame.get("Width", 0)), float(frame.get("Height", 0))
    kind = element.get("elementType", 0)
    children = [
        read_ios(child)
        for child in element.get("children") or []
        if child.get("elementType", 0) not in IOS_SKIPPED
        and not IOS_SCROLL_INDICATOR.match(child.get("label") or "")
    ]
    label = (element.get("label") or "").strip()
    value = element.get("value")
    if not label and isinstance(value, str):
        label = value.strip()
    if kind in IOS_CONTAINERS:
        label = ""
    return Node(
        label=label,
        text="",
        actionable=kind in IOS_ACTIONABLE,
        rect=(x, y, x + w, y + h),
        children=children,
    )


def read_tree(raw, scale, package):
    stripped = raw.lstrip()
    if stripped.startswith("<"):
        root = ET.fromstring(stripped)
        nodes = [
            read_android(n, scale, package)
            for n in root
            if n.tag == "node" and not (package and n.get("package") and n.get("package") != package)
        ]
        return "android", Node("", "", False, (0, 0, 0, 0), nodes)
    data = json.loads(stripped)
    if "axElement" in data or "elementType" in data:
        return "ios", read_ios(data.get("axElement", data))
    return "android", read_maestro_android(data, scale, package)


def visible(node):
    x1, y1, x2, y2 = node.rect
    return x2 > x1 and y2 > y1


def descendant_text(node):
    parts = []
    for child in node.children:
        own = child.label or child.text
        if own:
            parts.append(own)
        else:
            parts.extend(descendant_text(child))
    return parts


def walk(node, platform, inside_stop, stops):
    name = node.label or node.text
    is_stop = visible(node) and not inside_stop and (node.actionable or bool(name))
    if is_stop:
        if not name and platform == "android":
            name = " ".join(descendant_text(node)).strip()
        stops.append({"name": name, "actionable": node.actionable, "rect": node.rect})
    for child in node.children:
        walk(child, platform, inside_stop or is_stop, stops)


def is_glyph(name):
    compact = "".join(name.split())
    return len(compact) == 1 or (
        bool(compact) and not any(unicodedata.category(ch)[0] in ("L", "N") for ch in compact)
    )


def size(rect):
    return rect[2] - rect[0], rect[3] - rect[1]


def centre(rect):
    return (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2


def circle_meets_rect(c, r, rect):
    nx = min(max(c[0], rect[0]), rect[2])
    ny = min(max(c[1], rect[1]), rect[3])
    return (c[0] - nx) ** 2 + (c[1] - ny) ** 2 < r * r


def spacing_failures(targets):
    """Indices of undersized targets whose circle meets another target, or the
    circle of another undersized target."""
    r = SPACING / 2
    small = [i for i, t in enumerate(targets) if min(size(t)) < SPACING]
    failed = set()
    for i in small:
        c = centre(targets[i])
        for j, other in enumerate(targets):
            if j == i:
                continue
            if circle_meets_rect(c, r, other):
                failed.add(i)
                break
            if j in small:
                d = centre(other)
                if (c[0] - d[0]) ** 2 + (c[1] - d[1]) ** 2 < (2 * r) ** 2:
                    failed.add(i)
                    break
    return failed


def screen_rect(node):
    """The first visible rect from the root down: the window on iOS, the
    root view on Android."""
    queue = [node]
    while queue:
        current = queue.pop(0)
        if visible(current):
            return current.rect
        queue.extend(current.children)
    return (0.0, 0.0, 0.0, 0.0)


def on_screen(rect, screen):
    """Wholly inside the screen's height: a row half under a tab bar is content
    the bar overlays, not a stop the bar follows."""
    return rect[1] >= screen[1] and rect[3] <= screen[3]


def shares_column(a, b):
    return min(a[2], b[2]) > max(a[0], b[0])


def measure(raw, scale, package=None):
    platform, root = read_tree(raw, scale, package)
    stops = []
    walk(root, platform, False, stops)
    floor = FLOOR[platform]
    screen = screen_rect(root)
    for stop in stops:
        stop["flags"] = []
    for i, stop in enumerate(stops):
        if stop["actionable"] and not stop["name"]:
            stop["flags"].append("unnamed")
        if is_glyph(stop["name"]):
            stop["flags"].append("glyph")
        before = next(
            (
                s
                for s in reversed(stops[:i])
                if on_screen(s["rect"], screen) and shares_column(s["rect"], stop["rect"])
            ),
            None,
        )
        pinned_bottom = stop["rect"][1] >= screen[3] - BOTTOM_BAR
        if before is not None and not pinned_bottom and stop["rect"][3] <= before["rect"][1]:
            stop["flags"].append("order")
        if stop["actionable"] and min(size(stop["rect"])) < floor:
            stop["flags"].append("floor")
        x1, y1, x2, y2 = stop["rect"]
        if x2 <= screen[0] or y2 <= screen[1] or x1 >= screen[2] or y1 >= screen[3]:
            stop["flags"].append("offscreen")
    targets = [s for s in stops if s["actionable"]]
    for i in spacing_failures([t["rect"] for t in targets]):
        targets[i]["flags"].append("spacing")
    counts = {"stops": len(stops)}
    for flag in FLAGS:
        counts[flag] = sum(flag in s["flags"] for s in stops)
    return {"platform": platform, "depth": depth(root), "counts": counts, "stops": stops}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--density", type=float, default=480)
    parser.add_argument("--package", default="com.veloq.app.dev")
    args = parser.parse_args()

    results = []
    for path in args.files:
        raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
        result = measure(raw, args.density / 160, args.package)
        result["file"] = path
        results.append(result)

    if args.json:
        json.dump(results, sys.stdout, ensure_ascii=False, indent=1)
        print()
        return
    print("| File | Platform | Depth | Stops | Unnamed | Glyph | Order | Spacing | Floor | Offscreen |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        c = r["counts"]
        print(
            f"| {r['file']} | {r['platform']} | {r['depth']} | {c['stops']} | {c['unnamed']} | {c['glyph']}"
            f" | {c['order']} | {c['spacing']} | {c['floor']} | {c['offscreen']} |"
        )
    if args.list:
        for r in results:
            print(f"\n{r['file']}")
            for i, s in enumerate(r["stops"]):
                x1, y1, x2, y2 = s["rect"]
                kind = "control" if s["actionable"] else "text"
                flags = ",".join(s["flags"])
                print(
                    f"{i + 1:3} {kind:7} {x2 - x1:5.0f}x{y2 - y1:<5.0f} @{x1:.0f},{y1:.0f}"
                    f"  {s['name'][:60]!r}  {flags}"
                )


if __name__ == "__main__":
    main()
