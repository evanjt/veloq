import React, { useMemo } from 'react';
import { Picture } from '@shopify/react-native-skia';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';

import { colors, strengthTone } from '@/theme';
import { Canvas } from '@/shared/ui/SkiaCanvas';
import { BODY_BOX, bodyPairPicture, type BodyGender } from '../lib/bodyDiagramPicture';

const INTENSITY_COLOURS = [strengthTone.secondary, strengthTone.primary];

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
  const picture = useMemo(
    () => bodyPairPicture(muscles, gender, scale, INTENSITY_COLOURS, colors.border),
    [muscles, gender, scale]
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
