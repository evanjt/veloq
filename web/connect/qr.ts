// @ts-nocheck
// toqr 0.1.1, vendored unchanged from its npm build so the page loads no
// third-party script. MIT License. Copyright (c) Phil Pluckthun,
// Copyright (c) 650 Industries, Inc. (aka Expo). Full notice: qr.LICENSE.txt.

const t = new Uint8Array(512);

const n = new Uint8Array(256);

for (let e = 0, o = 1; e < 255; e++) {
  t[e] = o;
  n[o] = e;
  o <<= 1;
  if (256 & o) {
    o ^= 285;
  }
}

for (let n = 255; n < 512; n++) {
  t[n] = t[n - 255];
}

const gmul = (e, o) => e > 0 && o > 0 ? t[n[e] + n[o]] : 0;

const gpow = (e, o) => t[o * n[e] % 255];

const genRS = t => {
  const n = new Uint8Array(t + 2);
  const e = new Uint8Array(t + 1);
  e[0] = 1;
  for (let o = 0; o < t; o++) {
    const t = gpow(2, o);
    n.fill(0, 0, o + 2);
    for (let s = 0; s < o + 1; s++) {
      n[s] ^= e[s];
      n[s + 1] ^= gmul(e[s], t);
    }
    for (let t = 0; t < o + 2; t++) {
      e[t] = n[t];
    }
  }
  return e;
};

const encodeRS = (t, n) => {
  const e = genRS(n);
  const o = new Uint8Array(t.byteLength + e.byteLength - 1);
  o.set(t);
  for (let n = 0; n < t.byteLength; n++) {
    const t = o[n];
    if (t) {
      for (let s = 1; s < e.byteLength; s++) {
        o[n + s] ^= gmul(e[s], t);
      }
    }
  }
  return o.subarray(t.byteLength);
};

const e = [ 0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706 ];

const o = [ [ 0, 0, 0, 0 ], [ 10, 7, 17, 13 ], [ 16, 10, 28, 22 ], [ 26, 15, 44, 36 ], [ 36, 20, 64, 52 ], [ 48, 26, 88, 72 ], [ 64, 36, 112, 96 ], [ 72, 40, 130, 108 ], [ 88, 48, 156, 132 ], [ 110, 60, 192, 160 ], [ 130, 72, 224, 192 ], [ 150, 80, 264, 224 ], [ 176, 96, 308, 260 ], [ 198, 104, 352, 288 ], [ 216, 120, 384, 320 ], [ 240, 132, 432, 360 ], [ 280, 144, 480, 408 ], [ 308, 168, 532, 448 ], [ 338, 180, 588, 504 ], [ 364, 196, 650, 546 ], [ 416, 224, 700, 600 ], [ 442, 224, 750, 644 ], [ 476, 252, 816, 690 ], [ 504, 270, 900, 750 ], [ 560, 300, 960, 810 ], [ 588, 312, 1050, 870 ], [ 644, 336, 1110, 952 ], [ 700, 360, 1200, 1020 ], [ 728, 390, 1260, 1050 ], [ 784, 420, 1350, 1140 ], [ 812, 450, 1440, 1200 ], [ 868, 480, 1530, 1290 ], [ 924, 510, 1620, 1350 ], [ 980, 540, 1710, 1440 ], [ 1036, 570, 1800, 1530 ], [ 1064, 570, 1890, 1590 ], [ 1120, 600, 1980, 1680 ], [ 1204, 630, 2100, 1770 ], [ 1260, 660, 2220, 1860 ], [ 1316, 720, 2310, 1950 ], [ 1372, 750, 2430, 2040 ] ];

const s = [ [ 0, 0, 0, 0 ], [ 1, 1, 1, 1 ], [ 1, 1, 1, 1 ], [ 1, 1, 2, 2 ], [ 2, 1, 4, 2 ], [ 2, 1, 4, 4 ], [ 4, 2, 4, 4 ], [ 4, 2, 5, 6 ], [ 4, 2, 6, 6 ], [ 5, 2, 8, 8 ], [ 5, 4, 8, 8 ], [ 5, 4, 11, 8 ], [ 8, 4, 11, 10 ], [ 9, 4, 16, 12 ], [ 9, 4, 16, 16 ], [ 10, 6, 18, 12 ], [ 10, 6, 16, 17 ], [ 11, 6, 19, 16 ], [ 13, 6, 21, 18 ], [ 14, 7, 25, 21 ], [ 16, 8, 25, 20 ], [ 17, 8, 25, 23 ], [ 17, 9, 34, 23 ], [ 18, 9, 30, 25 ], [ 20, 10, 32, 27 ], [ 21, 12, 35, 29 ], [ 23, 12, 37, 34 ], [ 25, 12, 40, 34 ], [ 26, 13, 42, 35 ], [ 28, 14, 45, 38 ], [ 29, 15, 48, 40 ], [ 31, 16, 51, 43 ], [ 33, 17, 54, 45 ], [ 35, 18, 57, 48 ], [ 37, 19, 60, 51 ], [ 38, 19, 63, 53 ], [ 40, 20, 66, 56 ], [ 43, 21, 70, 59 ], [ 45, 22, 74, 62 ], [ 47, 24, 77, 65 ], [ 49, 25, 81, 68 ] ];

const r = [ 0, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93, 97, 101, 105, 109, 113, 117, 121, 125, 129, 133, 137, 141, 145, 149, 153, 157, 161, 165, 169, 173, 177 ];

const c = [ [], [], [ 4, 16 ], [ 4, 20 ], [ 4, 24 ], [ 4, 28 ], [ 4, 32 ], [ 4, 20, 36 ], [ 4, 22, 40 ], [ 4, 24, 44 ], [ 4, 26, 48 ], [ 4, 28, 52 ], [ 4, 30, 56 ], [ 4, 32, 60 ], [ 4, 24, 44, 64 ], [ 4, 24, 46, 68 ], [ 4, 24, 48, 72 ], [ 4, 28, 52, 76 ], [ 4, 28, 54, 80 ], [ 4, 28, 56, 84 ], [ 4, 32, 60, 88 ], [ 4, 26, 48, 70, 92 ], [ 4, 24, 48, 72, 96 ], [ 4, 28, 52, 76, 100 ], [ 4, 26, 52, 78, 104 ], [ 4, 30, 56, 82, 108 ], [ 4, 28, 56, 84, 112 ], [ 4, 32, 60, 88, 116 ], [ 4, 24, 48, 72, 96, 120 ], [ 4, 28, 52, 76, 100, 124 ], [ 4, 24, 50, 76, 102, 128 ], [ 4, 28, 54, 80, 106, 132 ], [ 4, 32, 58, 84, 110, 136 ], [ 4, 28, 56, 84, 112, 140 ], [ 4, 32, 60, 88, 116, 144 ], [ 4, 28, 52, 76, 100, 124, 148 ], [ 4, 22, 48, 74, 100, 126, 152 ], [ 4, 26, 52, 78, 104, 130, 156 ], [ 4, 30, 56, 82, 108, 134, 160 ], [ 4, 24, 52, 80, 108, 136, 164 ], [ 4, 28, 56, 84, 112, 140, 168 ] ];

const makeSegments = (t, n, s) => {
  const r = e[n] - o[n][s];
  const c = new Uint8Array(r);
  let f = 0;
  let l = 0;
  if (n > 9) {
    const n = 65535 & t.byteLength;
    c[0] = 64 | n >>> 12 & 15;
    c[1] = n >>> 4 & 255;
    f = (15 & n) << 4;
    l = 2;
  } else {
    const n = 255 & t.byteLength;
    c[0] = 64 | n >>> 4 & 15;
    f = (15 & n) << 4;
    l = 1;
  }
  let i = 0;
  while (i + 1 < t.byteLength) {
    const n = t[i++] << 8 | t[i++];
    c[l++] = f | n >>> 12;
    c[l++] = n >>> 4 & 255;
    f = n << 4 & 240;
  }
  if (i < t.byteLength) {
    c[l++] = f | t[i] >>> 4;
    f = t[i] << 4 & 240;
  }
  c[l++] = f;
  for (let t = 0; l < r; t++) {
    c[l++] = 1 & t ? 17 : 236;
  }
  return c;
};

const getBestVersion = (t, n) => {
  for (let s = 1; s <= 40; s++) {
    let r = e[s] - o[s][n];
    r -= s > 9 ? 3 : 2;
    if (r >= t.byteLength) {
      return s;
    }
  }
  throw new RangeError("Bytes exceed max length");
};

const encodeData = (t, n, e) => {
  const r = t.byteLength + o[n][e];
  const c = s[n][e];
  const f = c - r % c;
  const l = t.byteLength / c | 0;
  const i = (r / c | 0) - l;
  const y = t.byteLength;
  const h = new Uint8Array(r);
  for (let n = 0, e = 0; n < c; n++) {
    const o = n < f ? l : l + 1;
    const s = encodeRS(t.subarray(e, e + o), i);
    for (let s = 0; s < o; s++) {
      h[s < l ? s * c + n : l * c + (n - f)] = t[e + s];
    }
    for (let t = 0; t < i; t++) {
      h[y + t * c + n] = s[t];
    }
    e += o;
  }
  return h;
};

const setSquare = (t, n, e, o, s) => {
  const r = (e + s) * n;
  for (let c = e * n; c < r; c += n) {
    t.fill(1, c + o, c + o + s);
  }
};

const setPattern = (t, n, e, o, s) => {
  const r = e * n + o;
  for (let e = 0; e < s; e++) {
    for (let o = 0; o < s; o++) {
      const c = o < s - 1 - o ? o : s - 1 - o;
      const f = e < s - 1 - e ? e : s - 1 - e;
      t[r + e * n + o] = 1 !== (c < f ? c : f) ? 1 : 0;
    }
  }
};

const writeFinderPatterns = (t, n, e) => {
  const o = e - 7;
  setPattern(t, e, 0, 0, 7);
  setPattern(t, e, o, 0, 7);
  setPattern(t, e, 0, o, 7);
  setSquare(n, e, 0, 0, 8);
  setSquare(n, e, o - 1, 0, 8);
  setSquare(n, e, 0, o - 1, 8);
};

const writeAlignmentPatterns = (t, n, e, o) => {
  const s = c[o];
  for (let o = 0; o < s.length; o++) {
    const r = s[o];
    for (let c = 0; c < s.length; c++) {
      if ((o || c % (s.length - 1)) && (c || o % (s.length - 1))) {
        const o = s[c];
        setPattern(t, e, r, o, 5);
        setSquare(n, e, r, o, 5);
      }
    }
  }
};

const writeTimingPatterns = (t, n, e) => {
  const o = e - 7;
  for (let s = 8; s < o; s++) {
    const o = s * e + 6;
    if (!n[o]) {
      n[o] = 1;
      t[o] = (s + 1) % 2;
    }
    const r = 6 * e + s;
    if (!n[r]) {
      n[r] = 1;
      t[r] = (s + 1) % 2;
    }
  }
};

const reserveFormatInfo = (t, n) => {
  const e = n - 7 - 1;
  t[8 * n + 8] = 1;
  for (let o = 0; o < 8; o++) {
    t[o * n + 8] = 1;
    t[8 * n + o] = 1;
    t[(e + o) * n + 8] = 1;
    t[8 * n + e + o] = 1;
  }
};

const reserveVersionInfo = (t, n, e) => {
  if (e >= 7) {
    const e = n - 7 - 4;
    for (let o = 0; o < 6; o++) {
      for (let s = 0; s < 3; s++) {
        t[(e + s) * n + o] = 1;
        t[o * n + e + s] = 1;
      }
    }
  }
};

const writeData = (t, n, e, o) => {
  let s = 0;
  let r = e - 1;
  let c = -1;
  let f = 7;
  while (s < o.byteLength) {
    if (6 === r) {
      r--;
    }
    for (let l = 0; l < e; l++) {
      for (let i = 0; i < 2; i++) {
        const y = r - i;
        const h = -1 === c ? e - l - 1 : l;
        if (n[h * e + y]) {
          continue;
        }
        t[h * e + y] = o[s] >>> f & 1;
        if (0 === f--) {
          f = 7;
          if (++s >= o.byteLength) {
            return;
          }
        }
      }
    }
    c = -c;
    r -= 2;
  }
};

const xorPatternN0 = (t, n, e) => {
  for (let o = 0, s = 0; o < e; o++, s += e) {
    for (let r = 0; r < e; r++) {
      const e = s + r;
      if (!(n[e] || o + r & 1)) {
        t[e] ^= 1;
      }
    }
  }
};

const xorPatternN1 = (t, n, e) => {
  for (let o = 0, s = 0; o < e; o++, s += e) {
    for (let r = 0; r < e; r++) {
      const e = s + r;
      if (!(n[e] || 1 & o)) {
        t[e] ^= 1;
      }
    }
  }
};

const xorPatternN2 = (t, n, e) => {
  for (let o = 0, s = 0; o < e; o++, s += e) {
    for (let o = 0; o < e; o++) {
      const e = s + o;
      if (!n[e] && o % 3 == 0) {
        t[e] ^= 1;
      }
    }
  }
};

const xorPatternN3 = (t, n, e) => {
  for (let o = 0, s = 0; o < e; o++, s += e) {
    for (let r = 0; r < e; r++) {
      const e = s + r;
      if (!n[e] && (o + r) % 3 == 0) {
        t[e] ^= 1;
      }
    }
  }
};

const xorPatternN4 = (t, n, e) => {
  for (let o = 0, s = 0; o < e; o++, s += e) {
    const r = o / 2 | 0;
    for (let o = 0; o < e; o++) {
      const e = s + o;
      if (!(n[e] || r + (o / 3 | 0) & 1)) {
        t[e] ^= 1;
      }
    }
  }
};

const xorPatternN5 = (t, n, e) => {
  for (let o = 0, s = 0; o < e; o++, s += e) {
    for (let r = 0; r < e; r++) {
      const e = s + r;
      const c = o * r;
      if (!n[e] && (1 & c) + c % 3 == 0) {
        t[e] ^= 1;
      }
    }
  }
};

const xorPatternN6 = (t, n, e) => {
  for (let o = 0, s = 0; o < e; o++, s += e) {
    for (let r = 0; r < e; r++) {
      const e = s + r;
      const c = o * r;
      if (!n[e] && ((1 & c) + c % 3) % 2 == 0) {
        t[e] ^= 1;
      }
    }
  }
};

const xorPatternN7 = (t, n, e) => {
  for (let o = 0, s = 0; o < e; o++, s += e) {
    for (let r = 0; r < e; r++) {
      const e = s + r;
      if (!(n[e] || o * r % 3 + (o + r & 1) & 1)) {
        t[e] ^= 1;
      }
    }
  }
};

const xorPattern = (t, n, e, o) => {
  switch (o) {
   case 0:
    return xorPatternN0(t, n, e);

   case 1:
    return xorPatternN1(t, n, e);

   case 2:
    return xorPatternN2(t, n, e);

   case 3:
    return xorPatternN3(t, n, e);

   case 4:
    return xorPatternN4(t, n, e);

   case 5:
    return xorPatternN5(t, n, e);

   case 6:
    return xorPatternN6(t, n, e);

   case 7:
    return xorPatternN7(t, n, e);
  }
};

const computePenalty = (t, n) => {
  let e = 0;
  let o = 0;
  for (let s = 0; s < n; s++) {
    let r = 1;
    let c = 1;
    let f = 0;
    let l = 0;
    for (let i = 0; i < n; i++) {
      const y = s * n + i;
      const h = i * n + s;
      o += t[y];
      if (i > 0) {
        if (t[y - 1] === t[y]) {
          r++;
        } else {
          if (r >= 5) {
            e += r - 5 + 3;
          }
          r = 1;
        }
        if (t[h - n] === t[h]) {
          c++;
        } else {
          if (c >= 5) {
            e += c - 5 + 3;
          }
          c = 1;
        }
      }
      if (s < n - 1 && i < n - 1 && t[y] === t[y + 1] && t[y] === t[y + n] && t[y] === t[y + n + 1]) {
        e += 3;
      }
      f = f << 1 & 2047 | t[y];
      l = l << 1 & 2047 | t[h];
      if (i >= 10) {
        if (1488 === f || 93 === f) {
          e += 40;
        }
        if (1488 === l || 93 === l) {
          e += 40;
        }
      }
    }
    if (r >= 5) {
      e += r - 5 + 3;
    }
    if (c >= 5) {
      e += c - 5 + 3;
    }
  }
  const s = 100 * Math.abs(o / t.byteLength - .5);
  e += 10 * Math.floor(s / 5);
  return e;
};

const applyBestPattern = (t, n, e) => {
  let o = 0;
  let s = 0;
  const r = new Uint8Array(t.byteLength);
  for (let c = 0; c <= 7; c += 1) {
    r.set(t);
    xorPattern(r, n, e, c);
    const f = computePenalty(r, e);
    if (0 === c || f < o) {
      o = f;
      s = c;
    }
  }
  xorPattern(t, n, e, s);
  return s;
};

const encodeFormatInfo = (t, n) => {
  const e = (t << 3 | n) << 10;
  let o = e;
  for (let t = 0; t < 5; t++) {
    if (o & 1 << 14 - t) {
      o ^= 1335 << 4 - t;
    }
  }
  return 21522 ^ (o | e);
};

const writeFormatInfo = (t, n, e, o) => {
  const s = encodeFormatInfo(e, o);
  let r = 14;
  for (let e = 0; e < 6; e++) {
    t[8 * n + e] = s >> r-- & 1;
  }
  t[8 * n + 7] = s >> r-- & 1;
  t[8 * n + 8] = s >> r-- & 1;
  t[7 * n + 8] = s >> r-- & 1;
  for (let e = 0; e < 6; e++) {
    t[(5 - e) * n + 8] = s >> r-- & 1;
  }
  r = 14;
  for (let e = 0; e < 7; e++) {
    t[(n - 1 - e) * n + 8] = s >> r-- & 1;
  }
  t[(n - 8) * n + 8] = 1;
  for (let e = 0; e < 8; e++) {
    t[8 * n + n - 8 + e] = s >> r-- & 1;
  }
};

const encodeVersionInfo = t => {
  const n = t << 12;
  let e = n;
  for (let t = 0; t < 6; t++) {
    if (e & 1 << 17 - t) {
      e ^= 7973 << 5 - t;
    }
  }
  return e | n;
};

const writeVersionInfo = (t, n, e) => {
  if (e >= 7) {
    const o = encodeVersionInfo(e);
    for (let e = 0; e < 6; e++) {
      for (let s = 0; s < 3; s++) {
        const r = o >>> 3 * e + s & 1;
        t[(n - 11 + s) * n + e] = r;
        t[e * n + n - 11 + s] = r;
      }
    }
  }
};

const encodeBytes = (t, n) => {
  const e = getBestVersion(t, n);
  const o = makeSegments(t, e, n);
  const s = encodeData(o, e, n);
  const c = r[e];
  const f = new Uint8Array(c * c);
  const l = new Uint8Array(c * c);
  writeFinderPatterns(f, l, c);
  writeAlignmentPatterns(f, l, c, e);
  writeTimingPatterns(f, l, c);
  reserveFormatInfo(l, c);
  reserveVersionInfo(l, c, e);
  writeData(f, l, c, s);
  const i = applyBestPattern(f, l, c);
  writeFormatInfo(f, c, n, i);
  writeVersionInfo(f, c, e);
  return f;
};

const f = new TextEncoder;

const toQR = (t, n = 1) => {
  const e = "string" == typeof t ? f.encode(t) : t;
  return encodeBytes(e, n);
};

export { toQR };
