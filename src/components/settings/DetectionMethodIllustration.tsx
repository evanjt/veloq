import React, { useEffect, useState, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/hooks';

interface Props {
  method: 'corridor' | 'density' | 'flow';
  proximity: number;
  minSectionLength: number;
  minActivities: number;
  minRoutes: number;
}

const REF_LAT = 46.22;
const REF_LNG = 7.36;
const LNG_SPAN = 0.04;
const LAT_SPAN = 0.02;

function svgToGps(x: number, y: number) {
  return { latitude: REF_LAT - (y / 200) * LAT_SPAN, longitude: REF_LNG + (x / 400) * LNG_SPAN };
}
function gpsToSvg(lat: number, lng: number): [number, number] {
  return [((lng - REF_LNG) / LNG_SPAN) * 400, ((REF_LAT - lat) / LAT_SPAN) * 200];
}

type TraceDef = { pts: [number, number][]; route: number };

const BASE_TRACES: TraceDef[] = [
  {
    pts: [
      [15, 100],
      [60, 92],
      [120, 85],
      [200, 80],
      [280, 85],
      [340, 92],
      [385, 100],
    ],
    route: 0,
  },
  {
    pts: [
      [15, 101],
      [60, 93],
      [120, 86],
      [200, 81],
      [215, 55],
      [225, 30],
      [230, 10],
    ],
    route: 1,
  },
  {
    pts: [
      [15, 99],
      [60, 91],
      [120, 84],
      [200, 79],
      [215, 105],
      [225, 135],
      [230, 165],
    ],
    route: 2,
  },
  {
    pts: [
      [250, 190],
      [255, 160],
      [260, 130],
      [265, 105],
      [280, 86],
      [340, 93],
      [385, 101],
    ],
    route: 3,
  },
  {
    pts: [
      [170, 82],
      [200, 70],
      [230, 68],
      [250, 78],
      [240, 95],
      [215, 100],
      [190, 95],
      [170, 82],
    ],
    route: 4,
  },
  {
    pts: [
      [385, 100],
      [340, 92],
      [280, 85],
      [200, 80],
      [120, 85],
      [60, 92],
      [15, 100],
    ],
    route: 5,
  },
  {
    pts: [
      [175, 10],
      [180, 30],
      [185, 55],
      [195, 75],
      [200, 81],
      [280, 86],
      [340, 93],
      [385, 101],
    ],
    route: 6,
  },
  {
    pts: [
      [140, 84],
      [170, 82],
      [200, 80],
      [230, 82],
      [260, 85],
    ],
    route: 7,
  },
];

function buildTraces(): TraceDef[] {
  const out: TraceDef[] = [];
  for (let rep = 0; rep < 6; rep++) {
    const jx = (rep - 3) * 0.5;
    const jy = (rep - 3) * 0.3;
    for (const base of BASE_TRACES) {
      out.push({
        pts: base.pts.map(([x, y]) => [x + jx, y + jy] as [number, number]),
        route: base.route,
      });
    }
  }
  return out;
}

function densify(pts: [number, number][]): { latitude: number; longitude: number }[] {
  const out: { latitude: number; longitude: number }[] = [svgToGps(pts[0][0], pts[0][1])];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
    const steps = Math.ceil(dist / 3);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push(svgToGps(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
    }
  }
  return out;
}

const FFI_METHOD: Record<Props['method'], string> = {
  corridor: 'corridor',
  density: 'density_grid',
  flow: 'flow_graph',
};

const FALLBACK: Record<Props['method'], string[]> = {
  corridor: [
    '15,100 60,92 120,85 200,80 280,85 340,92 385,100',
    '15,101 60,93 120,86 200,81',
    '280,86 340,93 385,101',
    '170,82 200,70 230,68 250,78',
  ],
  density: ['60,92 120,85 200,80', '280,85 340,92 385,100'],
  flow: ['120,85 160,83', '200,80 240,83', '280,85 320,90'],
};

export function DetectionMethodIllustration({
  method,
  proximity,
  minSectionLength,
  minActivities,
  minRoutes,
}: Props) {
  const { isDark } = useTheme();
  const bg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';

  const [highlights, setHighlights] = useState<string[]>(FALLBACK[method]);

  const traces = useMemo(() => buildTraces(), []);
  const inputData = useMemo(() => {
    const tracks: [string, { latitude: number; longitude: number }[]][] = traces.map((t, i) => [
      `t${i}`,
      densify(t.pts),
    ]);
    const sportTypes: Record<string, string> = {};
    for (let i = 0; i < traces.length; i++) sportTypes[`t${i}`] = 'Run';
    return {
      tracksJson: JSON.stringify(tracks),
      sportTypesJson: JSON.stringify(sportTypes),
    };
  }, [traces]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const { getNativeModule } = require('@/lib/native/routeEngine');
        const mod = getNativeModule();
        if (!mod) {
          setHighlights(FALLBACK[method]);
          return;
        }

        const flowProx = method === 'flow' ? Math.max(25, Math.round(proximity / 3)) : proximity;
        const config = JSON.stringify({
          proximityThreshold: flowProx,
          minSectionLength,
          maxSectionLength: 200000,
          minActivities,
          clusterTolerance: 80,
          samplePoints: 50,
          detectionMode: 'discovery',
          includePotentials: false,
          scalePresets: [
            {
              name: 'short',
              minLength: 50,
              maxLength: 500,
              minActivities: Math.max(minActivities, 2),
            },
            {
              name: 'medium',
              minLength: 500,
              maxLength: 2000,
              minActivities: Math.max(minActivities, 2),
            },
            {
              name: 'long',
              minLength: 2000,
              maxLength: 50000,
              minActivities: Math.max(minActivities, 2),
            },
          ],
          preserveHierarchy: true,
          jaccardThreshold: 0.5,
          minRoutes,
          enableDensitySplits: false,
          mergeDistanceMultiplier: 4.0,
          minCellVisits: 3,
          divergenceThreshold: 0.1,
          minCorridorTracks: minActivities,
          detectionMethod: FFI_METHOD[method],
        });

        const resultJson: string = await mod.detectSectionsStandalone(
          inputData.tracksJson,
          inputData.sportTypesJson,
          config
        );

        if (cancelled) return;

        const sections: { polyline: { latitude: number; longitude: number }[] }[] =
          JSON.parse(resultJson);

        if (sections.length > 0) {
          setHighlights(
            sections.map((s) =>
              s.polyline.map((p) => gpsToSvg(p.latitude, p.longitude).join(',')).join(' ')
            )
          );
        } else {
          setHighlights(FALLBACK[method]);
        }
      } catch {
        setHighlights(FALLBACK[method]);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [method, proximity, minSectionLength, minActivities, minRoutes, inputData]);

  const displayTraces = BASE_TRACES.map((t) => t.pts.map((p) => p.join(',')).join(' '));

  return (
    <View style={{ backgroundColor: bg, borderRadius: 8, overflow: 'hidden', marginVertical: 8 }}>
      <Svg width="100%" height={160} viewBox="0 0 400 210">
        {displayTraces.map((points, i) => (
          <Polyline
            key={i}
            points={points}
            fill="none"
            stroke="grey"
            strokeWidth={2}
            opacity={0.18}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {highlights.map((points, i) => (
          <Polyline
            key={`h-${method}-${i}`}
            points={points}
            fill="none"
            stroke="#FC4C02"
            strokeWidth={3}
            opacity={0.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <Line
          x1={290}
          y1={205}
          x2={390}
          y2={205}
          stroke="rgba(128,128,128,0.5)"
          strokeWidth={1.5}
        />
        <Line x1={290} y1={202} x2={290} y2={208} stroke="rgba(128,128,128,0.5)" strokeWidth={1} />
        <Line x1={390} y1={202} x2={390} y2={208} stroke="rgba(128,128,128,0.5)" strokeWidth={1} />
        <SvgText x={340} y={201} textAnchor="middle" fill="rgba(128,128,128,0.5)" fontSize={8}>
          750m
        </SvgText>
      </Svg>
    </View>
  );
}
