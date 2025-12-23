import React, { useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MapStyleType } from './mapStyles';

interface Map3DWebViewProps {
  /** Route coordinates as [lng, lat] pairs */
  coordinates: [number, number][];
  /** Map theme */
  mapStyle: MapStyleType;
  /** Route line color */
  routeColor?: string;
  /** Initial camera pitch in degrees (0-85) */
  initialPitch?: number;
  /** Terrain exaggeration factor */
  terrainExaggeration?: number;
}

export interface Map3DWebViewRef {
  /** Reset bearing to north and pitch to look straight down */
  resetOrientation: () => void;
}

interface Map3DWebViewPropsInternal extends Map3DWebViewProps {
  /** Called when the map has finished loading */
  onMapReady?: () => void;
  /** Called when bearing changes (for compass sync) */
  onBearingChange?: (bearing: number) => void;
}

/**
 * 3D terrain map using MapLibre GL JS in a WebView.
 * Uses free AWS Terrain Tiles (no API key required).
 * Supports light, dark, and satellite base styles.
 */
export const Map3DWebView = forwardRef<Map3DWebViewRef, Map3DWebViewPropsInternal>(function Map3DWebView({
  coordinates,
  mapStyle,
  routeColor = '#FC4C02',
  initialPitch = 60,
  terrainExaggeration = 1.5,
  onMapReady,
  onBearingChange,
}, ref) {
  const webViewRef = useRef<WebView>(null);

  // Handle messages from WebView
  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'mapReady' && onMapReady) {
        onMapReady();
      } else if (data.type === 'bearingChange' && onBearingChange) {
        onBearingChange(data.bearing);
      }
    } catch {
      // Ignore parse errors
    }
  };

  // Expose reset method to parent
  useImperativeHandle(ref, () => ({
    resetOrientation: () => {
      webViewRef.current?.injectJavaScript(`
        if (window.map) {
          window.map.easeTo({
            bearing: 0,
            pitch: 0,
            duration: 500
          });
        }
        true;
      `);
    },
  }), []);

  // Calculate bounds from coordinates
  const bounds = useMemo(() => {
    if (coordinates.length === 0) return null;

    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    for (const [lng, lat] of coordinates) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    // Add padding
    const lngPad = (maxLng - minLng) * 0.1;
    const latPad = (maxLat - minLat) * 0.1;

    return {
      sw: [minLng - lngPad, minLat - latPad],
      ne: [maxLng + lngPad, maxLat + latPad],
    };
  }, [coordinates]);

  // Generate the HTML for the WebView
  const html = useMemo(() => {
    const coordsJSON = JSON.stringify(coordinates);
    const boundsJSON = bounds ? JSON.stringify(bounds) : 'null';
    const isSatellite = mapStyle === 'satellite';
    const isDark = mapStyle === 'dark' || mapStyle === 'satellite';

    // For satellite, we build a custom style; for others, use the style URL
    const styleConfig = isSatellite
      ? `{
          version: 8,
          sources: {
            'satellite': {
              type: 'raster',
              tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
              tileSize: 256,
              maxzoom: 14
            }
          },
          layers: [{
            id: 'satellite-layer',
            type: 'raster',
            source: 'satellite',
            minzoom: 0,
            maxzoom: 22
          }]
        }`
      : mapStyle === 'dark'
        ? `'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'`
        : `'https://tiles.openfreemap.org/styles/liberty'`;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>3D Map</title>
  <script src="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    #map { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const coordinates = ${coordsJSON};
    const bounds = ${boundsJSON};
    const isSatellite = ${isSatellite};

    // Create map with appropriate style
    window.map = new maplibregl.Map({
      container: 'map',
      style: ${styleConfig},
      bounds: bounds ? [bounds.sw, bounds.ne] : undefined,
      fitBoundsOptions: { padding: 50 },
      pitch: ${initialPitch},
      maxPitch: 85,
      bearing: 0,
      attributionControl: false,
    });

    const map = window.map;

    // Track bearing changes and notify React Native
    map.on('rotate', () => {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'bearingChange',
          bearing: map.getBearing()
        }));
      }
    });

    map.on('load', () => {
      // Notify React Native that map is ready
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
      }

      // Add AWS Terrain Tiles source (free, no API key)
      map.addSource('terrain', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
      });

      // Enable 3D terrain
      map.setTerrain({
        source: 'terrain',
        exaggeration: ${terrainExaggeration},
      });

      // Add sky layer for atmosphere effect
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 90.0],
          'sky-atmosphere-sun-intensity': 15,
        },
      });

      // Add hillshade for better depth perception (skip for satellite - already has shadows)
      if (!isSatellite) {
        map.addSource('hillshade', {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15,
        });

        map.addLayer({
          id: 'hillshading',
          type: 'hillshade',
          source: 'hillshade',
          layout: { visibility: 'visible' },
          paint: {
            'hillshade-shadow-color': '${isDark ? '#000000' : '#473B24'}',
            'hillshade-illumination-anchor': 'map',
            'hillshade-exaggeration': 0.3,
          },
        }, 'building');
      }

      // Add route if coordinates exist
      if (coordinates.length > 0) {
        map.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: coordinates,
            },
          },
        });

        // Route outline (for contrast)
        map.addLayer({
          id: 'route-outline',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#FFFFFF',
            'line-width': 6,
            'line-opacity': 0.8,
          },
        });

        // Route line
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '${routeColor}',
            'line-width': 4,
          },
        });
      }
    });
  </script>
</body>
</html>
    `;
  }, [coordinates, bounds, mapStyle, routeColor, initialPitch, terrainExaggeration]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        nestedScrollEnabled={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        originWhitelist={['*']}
        mixedContentMode="always"
        onMessage={handleMessage}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
