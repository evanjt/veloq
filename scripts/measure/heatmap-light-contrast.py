# Measures the light heatmap's contrast in device captures of the map tab.
# Reads the heatmap tiles the app drew to pick road centrelines by density,
# then samples each centreline and the bare ground beside it in the capture.
#
# python3 -I scripts/measure/heatmap-light-contrast.py densest <tile dir> <zoom> <lat> <lon> <radius km>
# python3 -I scripts/measure/heatmap-light-contrast.py measure <tile dir> <capture json>
# python3 -I scripts/measure/heatmap-light-contrast.py measure3d <2D output> <projected points> <capture>
import json
import math
import os
import sys

from PIL import Image

STOPS = [
    (0.0, 0, 0, 0, 0),
    (0.04, 13, 148, 136, 176),
    (0.14, 16, 163, 150, 190),
    (0.32, 20, 184, 166, 205),
    (0.58, 45, 212, 191, 220),
    (0.80, 94, 234, 212, 232),
    (0.94, 153, 246, 228, 242),
    (1.0, 204, 251, 241, 248),
]


def build_lut():
    lut = [(0, 0, 0, 0)]
    for i in range(1, 256):
        t = i / 255
        lower = next(s for s in range(len(STOPS) - 1) if STOPS[s + 1][0] >= t)
        a, b = STOPS[lower], STOPS[lower + 1]
        f = (t - a[0]) / (b[0] - a[0])
        lut.append(tuple(int(min(255, max(0, a[k] + (b[k] - a[k]) * f))) for k in range(1, 5)))
    return lut


LUT = build_lut()
LUT_INDEX = {}


def lut_index(rgba):
    if rgba[3] == 0:
        return 0
    if rgba not in LUT_INDEX:
        LUT_INDEX[rgba] = min(range(1, 256), key=lambda i: sum((rgba[k] - LUT[i][k]) ** 2 for k in range(4)))
    return LUT_INDEX[rgba]


class Tiles:
    def __init__(self, root, zoom):
        self.root, self.zoom, self.cache = root, zoom, {}

    def index_at(self, wx, wy):
        # World coordinates in 256-pixel tile units; the tiles are drawn at 512.
        tx, ty = int(wx // 256), int(wy // 256)
        key = (tx, ty)
        if key not in self.cache:
            path = os.path.join(self.root, str(self.zoom), str(tx), f'{ty}.png')
            self.cache[key] = Image.open(path).convert('RGBA') if os.path.exists(path) else None
        tile = self.cache[key]
        if tile is None:
            return 0
        px = min(511, int((wx - tx * 256) * 2))
        py = min(511, int((wy - ty * 256) * 2))
        return lut_index(tile.getpixel((px, py)))


def world(lat, lon, zoom):
    n = 256 * 2**zoom
    r = math.radians(lat)
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def lnglat(wx, wy, zoom):
    n = 256 * 2**zoom
    lon = wx / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * wy / n))))
    return lat, lon


def luminance(rgb):
    def channel(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def densest(root, zoom, lat, lon, radius_km):
    tiles = Tiles(root, zoom)
    cx, cy = world(lat, lon, zoom)
    metres_per_px = 156543.03 * math.cos(math.radians(lat)) / 2**zoom
    r = int(radius_km * 1000 / metres_per_px)
    best = (0, cx, cy)
    for dy in range(-r, r + 1, 2):
        for dx in range(-r, r + 1, 2):
            i = tiles.index_at(cx + dx, cy + dy)
            if i > best[0]:
                best = (i, cx + dx, cy + dy)
    la, lo = lnglat(best[1], best[2], zoom)
    print(json.dumps({'index': best[0], 'lat': la, 'lon': lo}))


def mean_rgb(img, x, y, dpr):
    xs = range(int(x * dpr), int(x * dpr) + dpr)
    ys = range(int(y * dpr), int(y * dpr) + dpr)
    px = [img.getpixel((i, j))[:3] for i in xs for j in ys]
    return tuple(round(sum(p[k] for p in px) / len(px)) for k in range(3))


def measure(root, capture_path):
    cap = json.load(open(capture_path))
    zoom, dpr = cap['zoom'], cap['dpr']
    w, h = cap['width'], cap['height']
    x0, y0, x1, y1 = cap['region']
    # The page asks for tiles one level deeper than its map zoom, read back from
    # its tile manager, and a css pixel there is one pixel of that zoom's world.
    tile_zoom = cap['tile_zoom']
    tiles = Tiles(root, tile_zoom)
    scale = 2 ** (tile_zoom - zoom - 1)
    cx, cy = world(cap['lat'], cap['lon'], tile_zoom)
    img = Image.open(cap['screenshot']).convert('RGB')
    oy = cap.get('offset_y', 0)

    def density(x, y):
        return tiles.index_at(cx + (x - w / 2) * scale, cy + (y - h / 2) * scale)

    grid = {(x, y): density(x, y) for x in range(x0 - 16, x1 + 16) for y in range(y0 - 16, y1 + 16)}
    points = []
    for x in range(x0, x1):
        for y in range(y0, y1):
            d = grid[(x, y)]
            if d == 0:
                continue
            ring = [grid[(x + i, y + j)] for i in range(-2, 3) for j in range(-2, 3)]
            if d < max(ring):
                continue
            ground = None
            for radius in range(3, 15):
                for i in range(-radius, radius + 1):
                    for j in range(-radius, radius + 1):
                        if max(abs(i), abs(j)) != radius:
                            continue
                        gx, gy = x + i, y + j
                        if all(grid.get((gx + a, gy + b), 1) == 0 for a in (-1, 0, 1) for b in (-1, 0, 1)):
                            ground = (gx, gy)
                            break
                    if ground:
                        break
                if ground:
                    break
            if ground is None:
                continue
            # The darkest core within a css pixel, since tile and screen register
            # to a pixel and a one-ride line is two or three pixels wide.
            road_rgb = min(
                (mean_rgb(img, x + i, y + j + oy / dpr, dpr) for i in (-1, 0, 1) for j in (-1, 0, 1)),
                key=luminance,
            )
            ground_rgb = mean_rgb(img, ground[0], ground[1] + oy / dpr, dpr)
            def at(px, py):
                return lnglat(cx + (px - w / 2) * scale, cy + (py - h / 2) * scale, tile_zoom)

            points.append(
                {
                    'x': x,
                    'y': y,
                    'road_at': at(x, y),
                    'ground_at': at(*ground),
                    'index': d,
                    'road': road_rgb,
                    'ground': ground_rgb,
                    'contrast': round(contrast(road_rgb, ground_rgb), 2),
                    'road_luminance': round(luminance(road_rgb), 4),
                }
            )
    points.sort(key=lambda p: p['contrast'])
    by_index = sorted(points, key=lambda p: p['index'])
    low = [p for p in by_index if p['index'] <= by_index[0]['index'] + 10] if points else []
    high = [p for p in by_index if p['index'] >= by_index[-1]['index'] - 10] if points else []

    def summary(ps):
        if not ps:
            return None
        cs = sorted(p['contrast'] for p in ps)
        ls = sorted(p['road_luminance'] for p in ps)
        return {
            'n': len(ps),
            'index_range': [min(p['index'] for p in ps), max(p['index'] for p in ps)],
            'contrast_min': cs[0],
            'contrast_p10': cs[len(cs) // 10],
            'contrast_median': cs[len(cs) // 2],
            'road_luminance_median': ls[len(ls) // 2],
            'example': ps[len(ps) // 2],
        }

    print(
        json.dumps(
            {
                'label': cap['label'],
                'centreline_pixels': len(points),
                'under_3': sum(p['contrast'] < 3 for p in points),
                'all': summary(points),
                'faintest': summary(low),
                'densest': summary(high),
                'lowest_ten': points[:10],
                'points': points,
            },
            indent=1,
        )
    )


def measure_3d(points_path, projected_path, screenshot, dpr=3, region=(10, 40, 290, 610)):
    # The 2D pass picked each centreline and its ground; the 3D page projected
    # both through its own camera and terrain, so only the capture is read here.
    points = json.load(open(points_path))['points']
    projected = json.load(open(projected_path))
    img = Image.open(screenshot).convert('RGB')
    x0, y0, x1, y1 = region
    out = []
    for p, (rx, ry, gx, gy) in zip(points, projected):
        if not (x0 <= rx < x1 and y0 <= ry < y1 and x0 <= gx < x1 and y0 <= gy < y1):
            continue
        road_rgb = min(
            (mean_rgb(img, rx + i, ry + j, dpr) for i in (-1, 0, 1) for j in (-1, 0, 1)),
            key=luminance,
        )
        ground_rgb = mean_rgb(img, gx, gy, dpr)
        out.append({'index': p['index'], 'x': round(rx), 'y': round(ry), 'road': road_rgb, 'ground': ground_rgb,
                    'contrast': round(contrast(road_rgb, ground_rgb), 2), 'road_luminance': round(luminance(road_rgb), 4)})
    out.sort(key=lambda p: p['contrast'])
    by_index = sorted(out, key=lambda p: p['index'])

    def summary(ps):
        if not ps:
            return None
        cs = sorted(p['contrast'] for p in ps)
        ls = sorted(p['road_luminance'] for p in ps)
        return {'n': len(ps), 'index_range': [ps[0]['index'], ps[-1]['index']], 'contrast_min': cs[0],
                'contrast_p10': cs[len(cs) // 10], 'contrast_median': cs[len(cs) // 2],
                'road_luminance_median': ls[len(ls) // 2]}

    low = [p for p in by_index if p['index'] <= by_index[0]['index'] + 10] if out else []
    high = [p for p in by_index if p['index'] >= by_index[-1]['index'] - 10] if out else []
    print(json.dumps({'capture': screenshot, 'under_3': sum(p['contrast'] < 3 for p in out), 'all': summary(by_index),
                      'faintest': summary(low), 'densest': summary(high), 'lowest_ten': out[:10]}, indent=1))


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'densest':
        densest(sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]))
    elif mode == 'measure3d':
        measure_3d(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        measure(sys.argv[2], sys.argv[3])
