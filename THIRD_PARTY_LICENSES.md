# Third-Party Licenses

This document contains license information for third-party software included in Veloq.

## License Summary

All dependencies used in Veloq are compatible with commercial distribution. The majority use MIT or Apache-2.0 licenses.

### License Types Used

| License | Type | Commercial Use | Attribution Required |
|---------|------|----------------|---------------------|
| MIT | Permissive | Yes | Yes |
| Apache-2.0 | Permissive | Yes | Yes (+ NOTICE file) |
| BSD-2-Clause | Permissive | Yes | Yes |
| BSD-3-Clause | Permissive | Yes | Yes |
| ISC | Permissive | Yes | Yes |
| MPL-2.0 | Weak Copyleft | Yes | Yes (source availability) |
| Unicode-3.0 | Permissive | Yes | Yes |
| Zlib | Permissive | Yes | Minimal |
| CDLA-Permissive-2.0 | Permissive Data | Yes | Yes |
| Unlicense | Public Domain | Yes | No |
| BSL-1.0 (Boost) | Permissive | Yes | No |

---

## Native Engine (tracematch)

The tracematch Rust crate is developed by Evan Thomas and licensed under Apache-2.0.

### Rust Dependencies

#### MPL-2.0 Licensed (Mozilla Public License 2.0)

The following crates are licensed under MPL-2.0, a weak copyleft license. Source code for these crates is available at their respective repositories.

| Crate | Version | Repository |
|-------|---------|------------|
| uniffi | 0.30.0 | https://github.com/mozilla/uniffi-rs |
| uniffi_bindgen | 0.30.0 | https://github.com/mozilla/uniffi-rs |
| uniffi_build | 0.30.0 | https://github.com/mozilla/uniffi-rs |
| uniffi_core | 0.30.0 | https://github.com/mozilla/uniffi-rs |
| uniffi_internal_macros | 0.30.0 | https://github.com/mozilla/uniffi-rs |
| uniffi_macros | 0.30.0 | https://github.com/mozilla/uniffi-rs |
| uniffi_meta | 0.30.0 | https://github.com/mozilla/uniffi-rs |
| uniffi_pipeline | 0.30.0 | https://github.com/mozilla/uniffi-rs |
| uniffi_udl | 0.30.0 | https://github.com/mozilla/uniffi-rs |

**MPL-2.0 Compliance Note:** MPL-2.0 is a file-level copyleft license. Modifications to MPL-licensed files must be made available under MPL-2.0. The uniffi crates are used unmodified. Source code is available at the repository linked above.

#### ISC Licensed

| Crate | Version | Description |
|-------|---------|-------------|
| earcutr | 0.4.3 | Polygon triangulation |
| rustls-webpki | 0.103.8 | WebPKI certificate validation |
| untrusted | 0.9.0 | Input parsing utilities |

#### BSD-3-Clause Licensed

| Crate | Version | Description |
|-------|---------|-------------|
| subtle | 2.6.1 | Constant-time cryptographic operations |

#### BSD-2-Clause Licensed

| Crate | Version | Description |
|-------|---------|-------------|
| zerocopy | 0.8.31 | Zero-copy parsing |
| zerocopy-derive | 0.8.31 | Derive macros for zerocopy |

#### Unicode-3.0 Licensed

| Crate | Version | Description |
|-------|---------|-------------|
| icu_collections | 2.1.1 | ICU4X collections |
| icu_locale_core | 2.1.1 | ICU4X locale support |
| icu_normalizer | 2.1.1 | Unicode normalization |
| icu_normalizer_data | 2.1.1 | Normalization data |
| icu_properties | 2.1.2 | Unicode properties |
| icu_properties_data | 2.1.2 | Properties data |
| icu_provider | 2.1.1 | ICU4X data provider |
| litemap | 0.8.1 | Sorted key-value map |
| potential_utf | 0.1.4 | Potentially UTF string handling |
| tinystr | 0.8.2 | Small string type |
| writeable | 0.6.2 | Display trait extension |
| yoke | 0.8.1 | Zero-copy deserialization |
| yoke-derive | 0.8.1 | Derive macros for yoke |
| zerofrom | 0.1.6 | Zero-copy cloning |
| zerofrom-derive | 0.1.6 | Derive macros for zerofrom |
| zerotrie | 0.2.3 | Compact trie structure |
| zerovec | 0.11.5 | Zero-copy vectors |
| zerovec-derive | 0.11.2 | Derive macros for zerovec |

#### Zlib Licensed

| Crate | Version | Description |
|-------|---------|-------------|
| foldhash | 0.1.5 | Hash function |

#### CDLA-Permissive-2.0 Licensed

| Crate | Version | Description |
|-------|---------|-------------|
| webpki-roots | 1.0.5 | Mozilla CA certificate bundle |

#### Apache-2.0 AND ISC (Dual Requirement)

| Crate | Version | Description |
|-------|---------|-------------|
| ring | 0.17.14 | Cryptographic primitives |

**Note:** "AND" means both licenses must be satisfied. Both Apache-2.0 and ISC require attribution.

#### MIT OR Apache-2.0 (Dual Choice)

The majority of Rust dependencies are dual-licensed under MIT OR Apache-2.0. This includes:

- geo, geo-types (geospatial algorithms)
- rstar (R-tree spatial indexing)
- serde, serde_json (serialization)
- tokio, futures (async runtime)
- reqwest (HTTP client)
- rustls (TLS implementation)
- rayon (parallel processing)
- rusqlite (SQLite bindings)
- And many more...

For a complete list, run: `cargo tree --format "{p} {l}"` in the tracematch directory.

---

## JavaScript/TypeScript Dependencies

### Core Framework

| Package | License | Repository |
|---------|---------|------------|
| react | MIT | https://github.com/facebook/react |
| react-native | MIT | https://github.com/facebook/react-native |
| expo | MIT | https://github.com/expo/expo |

### Maps and Graphics

| Package | License | Repository |
|---------|---------|------------|
| @maplibre/maplibre-react-native | MIT | https://github.com/maplibre/maplibre-react-native |
| @mapbox/polyline | BSD-3-Clause | https://github.com/mapbox/polyline |
| @shopify/react-native-skia | MIT | https://github.com/Shopify/react-native-skia |
| react-native-svg | MIT | https://github.com/software-mansion/react-native-svg |
| victory-native | MIT | https://github.com/FormidableLabs/victory |

### State Management

| Package | License | Repository |
|---------|---------|------------|
| @tanstack/react-query | MIT | https://github.com/TanStack/query |
| zustand | MIT | https://github.com/pmndrs/zustand |
| zod | MIT | https://github.com/colinhacks/zod |

### UI Components

| Package | License | Repository |
|---------|---------|------------|
| react-native-paper | MIT | https://github.com/callstack/react-native-paper |
| react-native-gesture-handler | MIT | https://github.com/software-mansion/react-native-gesture-handler |
| react-native-reanimated | MIT | https://github.com/software-mansion/react-native-reanimated |
| react-native-screens | MIT | https://github.com/software-mansion/react-native-screens |
| react-native-safe-area-context | MIT | https://github.com/th3rdwave/react-native-safe-area-context |

### Networking and Utilities

| Package | License | Repository |
|---------|---------|------------|
| axios | MIT | https://github.com/axios/axios |
| i18next | MIT | https://github.com/i18next/i18next |
| react-i18next | MIT | https://github.com/i18next/react-i18next |
| intl-pluralrules | ISC | https://github.com/nicolo-ribaudo/intl-pluralrules |

---

## Map Data Attribution

Map tiles and data require separate attribution from the libraries:

### OpenStreetMap

Map data from OpenStreetMap requires the following attribution:

> Map data © OpenStreetMap contributors

Link: https://www.openstreetmap.org/copyright

### Terrain Data

If using Mapbox or MapTiler terrain:
- Follow the respective provider's attribution requirements
- Typically requires logo or text attribution in map corner

---

## Full License Texts

### MIT License

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache License 2.0

See: https://www.apache.org/licenses/LICENSE-2.0

### Mozilla Public License 2.0

See: https://www.mozilla.org/en-US/MPL/2.0/

### ISC License

```
ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### BSD-3-Clause License

```
BSD 3-Clause License

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.
```

### Unicode License (Unicode-3.0)

See: https://www.unicode.org/license.txt

---

*Last updated: 2026-01-24*
