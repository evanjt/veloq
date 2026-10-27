import type { ReactNode } from 'react';
import type { ExperimentalFeatureKey } from '../lib/experimentalFeatures';
import { useSurfaceShown } from '../lib/experimental';

interface Props {
  /** The experimental feature this card, row or screen belongs to. */
  feature: ExperimentalFeatureKey;
  children: ReactNode;
  /** What renders in its place while the feature is off. */
  fallback?: ReactNode;
}

/** Mounts its children only while their experimental feature is on, so nothing of it renders off. */
export function ExperimentalOnly({ feature, children, fallback = null }: Props) {
  const shown = useSurfaceShown()({ experimental: feature });
  return <>{shown ? children : fallback}</>;
}
