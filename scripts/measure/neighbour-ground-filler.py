#!/usr/bin/env python3
"""Asks each regional satellite source for the tile over a town that sits inside its
box but on a neighbour's ground, at zoom 15 and 16, and prints what came back: the
HTTP status, the byte count and whether the image is a flat fill, which is what a
blank 200 looks like. The source the stack would draw beneath it is asked for the
same tile, so the report shows what a cut box would reveal.

    python3 -I scripts/measure/neighbour-ground-filler.py
"""

import io
import math
import sys
import urllib.request

from PIL import Image, ImageStat

R = 6378137.0

SOURCES = {
    'ign': 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    'spain': 'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&Format=image/jpeg&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}',
    'swisstopo': 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    'baden-wuerttemberg': 'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=IMAGES_DOP_20_RGB&STYLES=&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&BBOX={bbox}',
    'austria': 'https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
    'eox': 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
    'luxembourg': 'https://wmts1.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg',
    'czechia': 'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/WMTS/tile/1.0.0/ORTOFOTO_WM/default/GoogleMapsCompatible/{z}/{y}/{x}',
    'wallonia': 'https://geoservices.wallonie.be/arcgis/services/IMAGERIE/ORTHO_LAST/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=0&STYLES=&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&BBOX={bbox}',
}

# town, lat, lng, the source whose box holds it and sits on top, the source beneath.
PROBES = [
    ('Vielha', 42.702, 0.797, 'ign', 'spain'),
    ('Bossost', 42.786, 0.692, 'ign', 'spain'),
    ('Puigcerda', 42.432, 1.928, 'ign', 'spain'),
    ('La Seu d Urgell', 42.358, 1.458, 'ign', 'spain'),
    ('Andorra la Vella', 42.507, 1.521, 'ign', 'spain'),
    ('Irun', 43.338, -1.789, 'ign', 'spain'),
    ('Hondarribia', 43.370, -1.795, 'ign', 'spain'),
    ('Singen', 47.762, 8.840, 'swisstopo', 'baden-wuerttemberg'),
    ('Lorrach', 47.615, 7.661, 'swisstopo', 'baden-wuerttemberg'),
    ('Waldshut', 47.623, 8.214, 'swisstopo', 'baden-wuerttemberg'),
    ('Konstanz', 47.660, 9.175, 'swisstopo', 'baden-wuerttemberg'),
    ('Bormio', 46.467, 10.370, 'austria', 'eox'),
    ('Tirano', 46.218, 10.169, 'swisstopo', 'austria'),
    ('Arlon', 49.683, 5.817, 'luxembourg', 'wallonia'),
    ('Houffalize', 50.132, 5.790, 'luxembourg', 'wallonia'),
    ('Vielsalm', 50.280, 5.915, 'luxembourg', 'wallonia'),
    ('Les', 42.812, 0.710, 'ign', 'spain'),
    ('Fos', 42.870, 0.740, 'ign', 'spain'),
    ('Bourg-Madame', 42.433, 1.948, 'ign', 'spain'),
    ('Biriatou', 43.330, -1.745, 'ign', 'spain'),
    ('Porlezza', 46.038, 9.130, 'swisstopo', 'eox'),
    ('Chiavenna', 46.320, 9.400, 'swisstopo', 'eox'),
    ('Stuhlingen', 47.745, 8.450, 'swisstopo', 'baden-wuerttemberg'),
    ('Kandern', 47.715, 7.660, 'swisstopo', 'baden-wuerttemberg'),
    ('Mullheim', 47.810, 7.630, 'swisstopo', 'baden-wuerttemberg'),
    ('Nauders', 46.890, 10.500, 'swisstopo', 'austria'),
    ('Budweis', 48.975, 14.475, 'austria', 'czechia'),
    ('Znojmo', 48.855, 16.050, 'austria', 'czechia'),
    ('Bratislava', 48.145, 17.100, 'austria', 'eox'),
    ('Sopron', 47.685, 16.590, 'austria', 'eox'),
    ('Bolzano', 46.500, 11.350, 'austria', 'eox'),
    ('Merano', 46.670, 11.160, 'austria', 'eox'),
    ('Longwy', 49.520, 5.760, 'luxembourg', 'ign'),
    ('Villerupt', 49.470, 5.930, 'luxembourg', 'ign'),
    ('Martelange', 49.830, 5.740, 'luxembourg', 'wallonia'),
    ('Rodange', 49.547, 5.840, 'luxembourg', 'wallonia'),
]


def tile(lat, lng, z):
    n = 2 ** z
    x = int((lng + 180) / 360 * n)
    rad = math.radians(lat)
    y = int((1 - math.log(math.tan(rad) + 1 / math.cos(rad)) / math.pi) / 2 * n)
    return z, x, y


def bbox3857(z, x, y):
    n = 2 ** z
    size = 2 * math.pi * R / n
    west = -math.pi * R + x * size
    north = math.pi * R - y * size
    return ','.join(f'{v:.3f}' for v in (west, north - size, west + size, north))


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'tile-probe/1'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(), r.headers.get('content-type', '')
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get('content-type', '')
    except Exception as e:  # noqa: BLE001
        return 0, str(e).encode(), ''


def describe(body, ctype):
    if not ctype.startswith('image/'):
        return 'not an image'
    try:
        img = Image.open(io.BytesIO(body)).convert('RGB')
    except Exception:  # noqa: BLE001
        return 'undecodable'
    stat = ImageStat.Stat(img)
    spread = max(hi - lo for lo, hi in stat.extrema)
    mean = tuple(round(m) for m in stat.mean)
    if spread <= 2:
        return f'flat fill {mean}'
    return f'imagery, mean {mean}, spread {spread}'


def main():
    print(f'{"town":18} {"z":>2} {"source":20} {"status":>6} {"bytes":>7}  what')
    for town, lat, lng, top, under in PROBES:
        for z in (15, 16):
            zxy = tile(lat, lng, z)
            for source in (top, under):
                url = SOURCES[source].format(z=zxy[0], x=zxy[1], y=zxy[2], bbox=bbox3857(*zxy))
                status, body, ctype = fetch(url)
                what = describe(body, ctype) if status == 200 else ctype
                print(f'{town:18} {z:>2} {source:20} {status:>6} {len(body):>7}  {what}')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
