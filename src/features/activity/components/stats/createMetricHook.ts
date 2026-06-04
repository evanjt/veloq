/**
 * @fileoverview createMetricHook - Factory for creating metric hooks
 *
 * Provides a factory function to create metric hooks with a consistent pattern.
 * All metric hooks follow the same structure:
 * 1. Take input data (activity, wellness, etc.)
 * 2. Use useMemo to compute a StatDetail object
 * 3. Return { stat: StatDetail | null }
 *
 * This factory reduces duplication while maintaining type safety.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { StatDetail } from './types';

/**
 * Configuration for creating a metric hook.
 *
 * @template TOptions - The options type for the created hook
 */
export interface MetricHookConfig<TOptions> {
  /**
   * Unique name for the hook (used for debugging).
   */
  name: string;

  /**
   * Compute the StatDetail from the input options.
   * Return null if the metric cannot be computed (e.g., missing data).
   *
   * @param options - The input options passed to the hook
   * @param t - Translation function
   * @returns StatDetail or null if the metric cannot be computed
   */
  compute: (options: TOptions, t: TFunction) => StatDetail | null;

  /**
   * Extract dependency values for useMemo.
   * These values will be compared to determine if the stat needs recomputation.
   *
   * @param options - The input options passed to the hook
   * @returns Array of dependency values
   */
  getDeps: (options: TOptions) => unknown[];
}

/**
 * Result type for metric hooks.
 */
export interface MetricHookResult {
  stat: StatDetail | null;
}

/**
 * Creates a metric hook with the standard pattern.
 *
 * This factory encapsulates the common boilerplate:
 * - useTranslation hook setup
 * - useMemo for computation caching
 * - Consistent return type
 *
 * @template TOptions - The options type for the created hook
 * @param config - Configuration for the metric hook
 * @returns A hook function that computes the metric
 *
 * @example
 * See `useCalorieMetrics.ts` for a real implementation example.
 */
export function createMetricHook<TOptions>(
  config: MetricHookConfig<TOptions>
): (options: TOptions) => MetricHookResult {
  const { compute, getDeps } = config;

  return function useMetricHook(options: TOptions): MetricHookResult {
    const { t } = useTranslation();

    const stat = useMemo(() => {
      return compute(options, t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...getDeps(options), t]);

    return { stat };
  };
}
