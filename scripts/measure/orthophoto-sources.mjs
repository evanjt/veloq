#!/usr/bin/env node
// Asks each candidate open orthophoto service for one web-mercator tile over a
// town it should cover, and prints what came back: the status, the content
// type, the byte count and whether the bytes are an image. A service with no
// {z}/{x}/{y} tile grid in EPSG:3857 is asked through WMS GetMap over the same
// tile's bbox, which is what a bbox-template fetch would send.
//
//   node scripts/measure/orthophoto-sources.mjs [id ...]

const R = 6378137;
const Z = 16;

function tile(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { z, x, y };
}

function bbox3857({ z, x, y }) {
  const n = 2 ** z;
  const size = (2 * Math.PI * R) / n;
  const west = -Math.PI * R + x * size;
  const north = Math.PI * R - y * size;
  return [west, north - size, west + size, north].map((v) => v.toFixed(3)).join(',');
}

function wms(base, layer, format = 'image/jpeg') {
  return `${base}${base.includes('?') ? '&' : '?'}SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=${format}&BBOX={bbox-epsg-3857}`;
}

/** id, licence as the capabilities answer states it, the template, and a town it covers. */
const CANDIDATES = [
  {
    id: 'flanders',
    licence: 'Vlaanderen gebruiksrecht geografische webdiensten (free, attribution)',
    // The layer's style identifier is empty, so STYLE=default is refused.
    template:
      'https://geo.api.vlaanderen.be/OMWRGBMRVL/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=omwrgbmrvl&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    at: { name: 'Ghent', lat: 51.054, lng: 3.722 },
  },
  {
    id: 'wallonia',
    licence: 'SPW; the service states no licence (ArcGIS grid is EPSG:31370)',
    template: wms(
      'https://geoservices.wallonie.be/arcgis/services/IMAGERIE/ORTHO_LAST/MapServer/WMSServer',
      '0'
    ),
    at: { name: 'Namur', lat: 50.467, lng: 4.867 },
  },
  {
    id: 'estonia',
    licence: 'Maa-amet open data licence (attribution)',
    template: 'https://tiles.maaamet.ee/tm/wmts/1.0.0/foto/default/GMC/{z}/{y}/{x}.jpg',
    at: { name: 'Tartu', lat: 58.378, lng: 26.729 },
  },
  {
    id: 'denmark',
    licence: 'Dataforsyningen: GetTile answers 403 without a token',
    template:
      'https://api.dataforsyningen.dk/orto_foraar_wmts_DAF?service=WMTS&request=GetTile&version=1.0.0&layer=orto_foraar_wmts&style=default&format=image/jpeg&tilematrixset=KortforsyningTilingDK&tilematrix={z}&tilerow={y}&tilecol={x}',
    at: { name: 'Odense', lat: 55.396, lng: 10.388 },
  },
  {
    id: 'slovenia',
    licence: 'GURS WMS: Fees none, AccessConstraints none',
    template: wms('https://ipi.eprostor.gov.si/wms-si-gurs-dts/wms', 'SI.GURS.ZPDZ:DOF025_3857'),
    at: { name: 'Ljubljana', lat: 46.051, lng: 14.506 },
  },
  {
    id: 'nrw',
    licence: 'dl-de/zero-2.0 (GovData open data principles)',
    // The WMTS grid EPSG_3857_16 numbers web-mercator zoom 5 as level "00", so
    // a {z} template cannot address it; the WMS takes the tile's bbox instead.
    template: wms('https://www.wms.nrw.de/geobasis/wms_nw_dop', 'nw_dop_rgb'),
    at: { name: 'Cologne', lat: 50.938, lng: 6.957 },
  },
  {
    id: 'saxony',
    licence: 'kostenfrei; conditions at geoportal.sachsen.de/cps/geosn.html',
    // The WMTS grid_3857 has the same zoom-5 origin as the NRW grid and its
    // GetTile answers 400 to every form tried; the WMS answers.
    template: wms('https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest', 'sn_dop_020'),
    at: { name: 'Dresden', lat: 51.05, lng: 13.738 },
  },
  {
    id: 'bavaria',
    licence: 'CC BY 4.0',
    template: wms('https://geoservices.bayern.de/od/wms/dop/v1/dop40', 'by_dop40c'),
    at: { name: 'Munich', lat: 48.137, lng: 11.575 },
  },
  {
    id: 'brandenburg',
    licence: 'dl-de/by-2.0, "© GeoBasis-DE/LGB"',
    template: wms('https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms', 'bebb_dop20c'),
    at: { name: 'Potsdam', lat: 52.4, lng: 13.06 },
  },
  {
    id: 'berlin',
    licence: 'dl-de/zero-2.0',
    template: wms('https://gdi.berlin.de/services/wms/truedop_2024', 'truedop_2024'),
    at: { name: 'Berlin', lat: 52.52, lng: 13.405 },
  },
  {
    id: 'thuringia',
    licence: 'CC BY 4.0, "© GDI-Th"',
    template: wms('https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP20', 'th_dop'),
    at: { name: 'Erfurt', lat: 50.978, lng: 11.029 },
  },
  {
    id: 'lower-saxony',
    licence: 'CC BY 4.0',
    template: wms('https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms', 'ni_dop20'),
    at: { name: 'Hanover', lat: 52.375, lng: 9.732 },
  },
  {
    id: 'schleswig-holstein',
    licence: 'CC BY 4.0, "© GeoBasis-DE/LVermGeo SH/CC BY 4.0"',
    template: wms('https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD', 'sh_dop20_rgb'),
    at: { name: 'Kiel', lat: 54.323, lng: 10.135 },
  },
  {
    id: 'hesse',
    licence: 'HVGG § 24, any use including commercial',
    template: wms(
      'https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows',
      'he_dop20_rgb'
    ),
    at: { name: 'Frankfurt', lat: 50.111, lng: 8.682 },
  },
  {
    id: 'rhineland-palatinate',
    licence: 'dl-de/by-2.0, "©GeoBasis-DE/LVermGeoRP"',
    template: wms('https://geo4.service24.rlp.de/wms/rp_dop20.fcgi', 'rp_dop20'),
    at: { name: 'Mainz', lat: 49.993, lng: 8.247 },
  },
  {
    id: 'saxony-anhalt',
    licence: 'open data service; licence text not in capabilities',
    template: wms(
      'https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest',
      'lsa_lvermgeo_dop20_2'
    ),
    at: { name: 'Magdeburg', lat: 52.131, lng: 11.628 },
  },
  {
    id: 'baden-wuerttemberg',
    licence: 'dl-de/by-2.0',
    template: wms(
      'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C',
      'IMAGES_DOP_20_RGB'
    ),
    at: { name: 'Stuttgart', lat: 48.776, lng: 9.182 },
  },
  {
    id: 'bremen',
    licence: 'CC BY, "Landesamt GeoInformation Bremen"',
    template: wms('https://geodienste.bremen.de/wms_dop20_2023', 'DOP20_2023_HB'),
    at: { name: 'Bremen', lat: 53.076, lng: 8.807 },
  },
];

function magic(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  return 'not an image';
}

function fill(template, t) {
  return template
    .replace('{z}', String(t.z))
    .replace('{x}', String(t.x))
    .replace('{y}', String(t.y))
    .replace('{bbox-epsg-3857}', bbox3857(t));
}

async function probe(c) {
  const t = tile(c.at.lat, c.at.lng, Z);
  const url = fill(c.template, t);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'orthophoto-probe' },
      signal: AbortSignal.timeout(25_000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const kind = magic(buf);
    const note = kind === 'not an image' ? buf.toString('utf8', 0, 160).replace(/\s+/g, ' ') : '';
    return {
      id: c.id,
      status: res.status,
      type: res.headers.get('content-type') ?? '',
      bytes: buf.length,
      kind,
      ms: Date.now() - started,
      grid: c.template.includes('{bbox-epsg-3857}') ? 'bbox' : 'xyz',
      note,
    };
  } catch (e) {
    return {
      id: c.id,
      status: 0,
      type: '',
      bytes: 0,
      kind: String(e.cause ?? e.message),
      ms: Date.now() - started,
      grid: '',
      note: '',
    };
  }
}

const wanted = process.argv.slice(2);
const chosen = wanted.length ? CANDIDATES.filter((c) => wanted.includes(c.id)) : CANDIDATES;
const results = await Promise.all(chosen.map(probe));
console.log('id                      grid status type                       bytes kind   ms');
for (const r of results) {
  console.log(
    `${r.id.padEnd(23)} ${r.grid.padEnd(4)} ${String(r.status).padEnd(6)} ${r.type.slice(0, 26).padEnd(26)} ${String(r.bytes).padStart(6)} ${r.kind.padEnd(6)} ${r.ms}${r.note ? `  ${r.note}` : ''}`
  );
}
for (const c of chosen) console.log(`${c.id}: ${c.licence} (${c.at.name} z${Z})`);
