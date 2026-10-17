import { CadenceUnit } from 'veloqrs';

/**
 * The short label for the unit the engine gives a sport's cadence in. Steps
 * and strokes a minute are both written spm.
 */
export function cadenceUnitLabel(unit: CadenceUnit): 'rpm' | 'spm' {
  return unit === CadenceUnit.Rpm ? 'rpm' : 'spm';
}
