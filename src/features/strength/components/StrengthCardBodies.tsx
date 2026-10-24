import React, { useMemo } from 'react';
import { Picture } from '@shopify/react-native-skia';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';

import { bodyDiagram, colors } from '@/theme';
import { useTheme } from '@/shared/app';
import { Canvas } from '@/shared/ui/SkiaCanvas';
import { BODY_BOX, bodyPairPicture, type BodyGender } from '../lib/bodyDiagramPicture';

interface StrengthCardBodiesProps {
  testID?: string;
  muscles: readonly ExtendedBodyPart[];
  gender: BodyGender;
  scale: number;
}

/**
 * A feed card's front and back body diagrams, drawn as one recorded picture on
 * one canvas. A card scrolls in and out of the feed many times, so it mounts
 * one view here rather than a view per shape; the interactive diagrams
 * elsewhere keep the library's own component.
 */
export function StrengthCardBodies({ testID, muscles, gender, scale }: StrengthCardBodiesProps) {
  const { isDark } = useTheme();
  const roles = bodyDiagram[isDark ? 'dark' : 'light'];
  const picture = useMemo(
    () => bodyPairPicture(muscles, gender, scale, [roles.secondary, roles.primary], colors.border),
    [muscles, gender, scale, roles]
  );
  const size = useMemo(
    () => ({ width: BODY_BOX.width * scale * 2, height: BODY_BOX.height * scale }),
    [scale]
  );
  return (
    <Canvas testID={testID} style={size}>
      <Picture picture={picture} />
    </Canvas>
  );
}
