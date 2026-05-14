import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/hooks';

interface Props {
  method: 'corridor' | 'density' | 'flow';
}

// 5 base traces representing different route groups.
// Displayed as thin grey lines on the illustration.
const TRACES = [
  '15,105 55,90 110,78 165,72 220,70 275,72 330,78 385,88',
  '16,106 56,91 111,79 165,73 185,52 200,30 210,15',
  '200,190 220,170 245,145 270,115 285,90 330,79 385,89',
  '165,73 195,65 225,63 255,65 275,73 260,88 225,92 195,88 165,73',
  '16,106 56,91 110,79 130,100 145,130 155,160 160,190',
];

// Pre-computed highlights matching what the real algorithms produce
// on 50 jittered copies of the base traces at balanced settings.
// Corridor: long dense corridors wherever many traces overlap.
const CORRIDOR = [
  '15,105 55,90 110,78 165,72 220,70 275,72 330,78 385,88',
  '16,106 56,91 111,79 165,73',
  '285,90 330,79 385,89',
  '165,73 195,65 225,63 255,65 275,73',
  '16,106 56,91 110,79',
];

// Density grid: only where 3+ distinct route groups share a stretch.
const DENSITY = ['55,90 110,78 165,72', '275,72 330,78 385,88'];

// Flow graph: short edges between junction points where traces diverge.
const FLOW = ['55,90 110,78', '110,78 165,72', '165,72 220,70', '275,72 330,78'];

const HIGHLIGHTS: Record<Props['method'], string[]> = {
  corridor: CORRIDOR,
  density: DENSITY,
  flow: FLOW,
};

export function DetectionMethodIllustration({ method }: Props) {
  const { isDark } = useTheme();
  const bg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';

  return (
    <View style={{ backgroundColor: bg, borderRadius: 8, overflow: 'hidden', marginVertical: 8 }}>
      <Svg width="100%" height={170} viewBox="0 0 400 210">
        {TRACES.map((points, i) => (
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
