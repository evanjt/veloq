import { LIBERTY_LAYERS_LAND } from './land';
import { LIBERTY_LAYERS_ROAD } from './road';
import { LIBERTY_LAYERS_BRIDGE } from './bridge';
import { LIBERTY_LAYERS_LABEL } from './label';

export const LIBERTY_LAYERS = [
  ...LIBERTY_LAYERS_LAND,
  ...LIBERTY_LAYERS_ROAD,
  ...LIBERTY_LAYERS_BRIDGE,
  ...LIBERTY_LAYERS_LABEL,
] as const;
