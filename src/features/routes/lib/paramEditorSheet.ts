import type { DetectionParamKey } from './detectionParams';
import type { GroupingParamKey } from './groupingParams';
import type { EditorUnit } from './paramUnits';

export type ParamEditorSheetInput = {
  label: string;
  initial: string;
  unit: EditorUnit | null;
} & ({ kind: 'param'; key: DetectionParamKey } | { kind: 'grouping'; key: GroupingParamKey });
