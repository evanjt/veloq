import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '@/hooks';

interface Props {
  method: 'corridor' | 'density' | 'flow';
  width?: number;
  height?: number;
}

const TRACES = [
  '20,100 60,80 120,60 180,50 240,50 280,60',
  '20,95 60,78 120,62 180,55 220,60 260,80 280,90',
  '20,105 55,85 110,65 170,52 230,48 280,55',
  '25,100 65,75 120,55 160,45 200,40 240,35 280,30',
  '25,105 60,82 115,68 155,48 195,42 235,38 275,35',
  '60,20 90,40 120,58 180,52 240,50 280,58',
  '65,25 95,42 120,55 150,50 180,48 210,55 240,70',
  '120,110 160,90 200,70 240,55 280,58',
];

const HIGHLIGHTS: Record<Props['method'], string[]> = {
  corridor: ['60,80 120,60 180,50 240,50', '20,100 60,80', '120,60 160,45 200,40 240,35 280,30'],
  density: ['100,62 140,55 180,50'],
  flow: ['60,80 90,68', '120,60 150,50', '180,50 210,50', '240,50 270,55', '120,60 145,48'],
};

export function DetectionMethodIllustration({ method, width = 300, height = 120 }: Props) {
  const { isDark } = useTheme();
  const bg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.15)';

  return (
    <View style={{ backgroundColor: bg, borderRadius: 8, overflow: 'hidden' }}>
      <Svg width={width} height={height} viewBox="0 0 300 120">
        {TRACES.map((points, i) => (
          <Polyline
            key={i}
            points={points}
            fill="none"
            stroke="grey"
            strokeWidth={1.5}
            opacity={0.15}
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
          />
        ))}
      </Svg>
    </View>
  );
}
