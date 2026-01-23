import React, { useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, darkColors } from '@/theme/colors';
import { getBoundsFromPoints } from '@/lib';
import type { MapStyleType } from './mapStyles';
import { getCombinedSatelliteStyle, SATELLITE_SOURCES } from './mapStyles';
import { DARK_MATTER_STYLE } from './darkMatterStyle';
import { SWITZERLAND_SIMPLE } from './countryBoundaries';

interface Map3DWebViewProps {
  /** Route coordinates as [lng, lat] pairs (optional - if not provided, just shows terrain) */
  coordinates?: [number, number][];
  /** Map theme */
  mapStyle: MapStyleType;
  /** Route line color */
  routeColor?: string;
  /** Initial camera pitch in degrees (0-85) */
  initialPitch?: number;
  /** Terrain exaggeration factor */
  terrainExaggeration?: number;
  /** Initial center as [lng, lat] - used when no coordinates provided */
  initialCenter?: [number, number];
  /** Initial zoom level - used when no coordinates provided */
  initialZoom?: number;
  /** GeoJSON for routes layer */
  routesGeoJSON?: GeoJSON.FeatureCollection;
  /** GeoJSON for sections layer */
  sectionsGeoJSON?: GeoJSON.FeatureCollection;
  /** GeoJSON for traces layer */
  tracesGeoJSON?: GeoJSON.FeatureCollection;
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
export const Map3DWebView = forwardRef<Map3DWebViewRef, Map3DWebViewPropsInternal>(
  function Map3DWebView(
    {
      coordinates = [],
      mapStyle,
      routeColor = colors.primary,
      initialPitch = 60,
      terrainExaggeration = 1.5,
      initialCenter,
      initialZoom = 12,
      routesGeoJSON,
      sectionsGeoJSON,
      tracesGeoJSON,
      onMapReady,
      onBearingChange,
    },
    ref
  ) {
    const webViewRef = useRef<WebView>(null);

    // Handle messages from WebView
    const handleMessage = (event: { nativeEvent: { data: string } }) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        // Validate message structure before using
        if (typeof data !== 'object' || data === null || typeof data.type !== 'string') {
          return;
        }
        if (data.type === 'mapReady' && onMapReady) {
          onMapReady();
        } else if (
          data.type === 'bearingChange' &&
          onBearingChange &&
          typeof data.bearing === 'number'
        ) {
          onBearingChange(data.bearing);
        }
      } catch {
        // Ignore parse errors
      }
    };

    // Expose reset method to parent
    useImperativeHandle(
      ref,
      () => ({
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
      }),
      []
    );

    // Calculate bounds from coordinates using utility
    // Coordinates are in [lng, lat] format, convert to {lat, lng} for utility
    const bounds = useMemo(() => {
      if (coordinates.length === 0) return null;

      // Convert [lng, lat] tuples to {lat, lng} objects
      const points = coordinates.map(([lng, lat]) => ({ lat, lng }));

      // Use utility with 10% padding
      return getBoundsFromPoints(points, 0.1);
    }, [coordinates]);

    // Use initial center/zoom when no coordinates provided
    const hasRoute = coordinates.length > 0;

    // Generate the HTML for the WebView
    const html = useMemo(() => {
      const coordsJSON = JSON.stringify(coordinates);
      const boundsJSON = bounds ? JSON.stringify(bounds) : 'null';
      const centerJSON = initialCenter ? JSON.stringify(initialCenter) : 'null';
      const routesJSON = routesGeoJSON ? JSON.stringify(routesGeoJSON) : 'null';
      const sectionsJSON = sectionsGeoJSON ? JSON.stringify(sectionsGeoJSON) : 'null';
      const tracesJSON = tracesGeoJSON ? JSON.stringify(tracesGeoJSON) : 'null';
      const isSatellite = mapStyle === 'satellite';
      const isDark = mapStyle === 'dark' || mapStyle === 'satellite';

      // For satellite, we use combined style with all regional sources layered
      // For dark, we use the bundled Dark Matter style with OpenFreeMap tiles
      const styleConfig = isSatellite
        ? JSON.stringify(getCombinedSatelliteStyle())
        : mapStyle === 'dark'
          ? JSON.stringify(DARK_MATTER_STYLE)
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
    const center = ${centerJSON};
    const routesData = ${routesJSON};
    const sectionsData = ${sectionsJSON};
    const tracesData = ${tracesJSON};
    const isSatellite = ${isSatellite};

    // Create map with appropriate style
    // Use bounds if available (from route), otherwise use center/zoom
    const mapOptions = {
      container: 'map',
      style: ${styleConfig},
      pitch: ${initialPitch},
      maxPitch: 85,
      bearing: 0,
      attributionControl: false,
    };

    if (bounds) {
      mapOptions.bounds = [bounds.sw, bounds.ne];
      mapOptions.fitBoundsOptions = { padding: 50 };
    } else if (center) {
      mapOptions.center = center;
      mapOptions.zoom = ${initialZoom};
    } else {
      mapOptions.center = [0, 0];
      mapOptions.zoom = 2;
    }

    window.map = new maplibregl.Map(mapOptions);

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

      // Add routes layer (grouped routes from activities)
      if (routesData && routesData.features && routesData.features.length > 0) {
        map.addSource('routes-source', {
          type: 'geojson',
          data: routesData,
        });

        map.addLayer({
          id: 'routes-layer',
          type: 'line',
          source: 'routes-source',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': 0.7,
          },
        });
      }

      // Add sections layer (frequent sections)
      if (sectionsData && sectionsData.features && sectionsData.features.length > 0) {
        map.addSource('sections-source', {
          type: 'geojson',
          data: sectionsData,
        });

        map.addLayer({
          id: 'sections-layer',
          type: 'line',
          source: 'sections-source',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#FFD700',
            'line-width': 4,
            'line-opacity': 0.8,
          },
        });
      }

      // Add traces layer (GPS traces when zoomed in)
      if (tracesData && tracesData.features && tracesData.features.length > 0) {
        map.addSource('traces-source', {
          type: 'geojson',
          data: tracesData,
        });

        map.addLayer({
          id: 'traces-layer',
          type: 'line',
          source: 'traces-source',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': 0.6,
          },
        });
      }
    });
  </script>
</body>
</html>
    `;
    }, [
      coordinates,
      bounds,
      initialCenter,
      initialZoom,
      mapStyle,
      routeColor,
      initialPitch,
      terrainExaggeration,
      routesGeoJSON,
      sectionsGeoJSON,
      tracesGeoJSON,
    ]);

    return (
      <View style={styles.container}>
        <WebView
          ref={webViewRef}
          source={{ html, baseUrl: 'https://veloq.fit/' }}
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
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.background,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
