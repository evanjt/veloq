import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '@/hooks';

interface Props {
  method: 'corridor' | 'density' | 'flow';
}

// 15 traces organized into 4 route groups. Main east-west corridor,
// a north branch, a south branch, and a local loop.
const TRACES = [
  '20,110 60,95 110,80 160,72 210,70 260,72 310,78 370,90',
  '25,115 65,98 115,82 165,75 215,72 265,75 315,80 375,88',
  '18,108 55,92 105,78 155,70 205,68 255,70 305,76 365,85',
  '22,112 62,96 112,81 162,74 212,71 262,74 312,79 372,92',
  '20,106 58,90 108,76 158,68 208,66 258,68 308,74 368,82',
  '22,112 60,96 110,80 155,72 180,55 200,35 215,20',
  '18,108 58,94 108,78 152,70 175,52 195,32 210,18',
  '25,114 63,98 113,82 158,74 182,58 202,38 218,22',
  '180,185 200,165 225,140 255,110 275,90 310,78 370,88',
  '185,188 205,168 228,142 258,112 278,92 312,80 372,90',
  '175,182 195,162 222,138 252,108 272,88 308,76 368,86',
  '140,110 160,95 190,90 210,95 220,110 200,125 170,125 140,110',
  '142,112 162,97 192,92 212,97 222,112 202,127 172,127 142,112',
  '138,108 158,93 188,88 208,93 218,108 198,123 168,123 138,108',
];

const HIGHLIGHTS: Record<Props['method'], string[]> = {
  corridor: [
    '20,110 60,95 110,80 160,72 210,70 260,72 310,78 370,90',
    '18,108 55,92 105,78 155,70 205,68 255,70 305,76 365,85',
    '22,112 60,96 110,80 155,72',
    '255,110 275,90 310,78 370,88',
    '140,110 160,95 190,90 210,95 220,110 200,125 170,125 140,110',
  ],
  density: ['110,80 160,72 210,70', '105,78 155,70 205,68', '310,78 370,90'],
  flow: [
    '110,80 140,76',
    '155,72 180,55',
    '210,70 240,71',
    '275,90 310,78',
    '160,95 190,90',
    '110,80 155,72',
  ],
};

export function DetectionMethodIllustration({ method }: Props) {
  const { isDark } = useTheme();
  const bg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';

  return (
    <View style={{ backgroundColor: bg, borderRadius: 8, overflow: 'hidden', marginVertical: 8 }}>
      <Svg width="100%" height={160} viewBox="0 0 400 200">
        {TRACES.map((points, i) => (
          <Polyline
            key={i}
            points={points}
            fill="none"
            stroke="grey"
            strokeWidth={1.5}
            opacity={0.15}
            strokeLinejoin="round"
          />
        ))}
        {HIGHLIGHTS[method].map((points, i) => (
          <Polyline
            key={`h-${i}`}
            points={points}
            fill="none"
            stroke="#FC4C02"
            strokeWidth={3}
            opacity={0.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}
