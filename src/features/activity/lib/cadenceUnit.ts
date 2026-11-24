import { FfiCadenceUnit } from 'veloqrs';

/**
 * The short label for the unit the engine gives a sport's cadence in. Steps
 * and strokes a minute are both written spm.
 */
export function cadenceUnitLabel(unit: FfiCadenceUnit): 'rpm' | 'spm' {
  return unit === FfiCadenceUnit.Rpm ? 'rpm' : 'spm';
}
