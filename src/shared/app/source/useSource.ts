import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor, type Source } from './index';

/**
 * The signed-in source, read from the auth state. Surfaces that name the
 * source or link to its pages read this and nothing else, so a source with no
 * pages (`links` null) hides the link and a source's own name never has to be
 * written into a string for another.
 */
export function useSource(): Source | null {
  const authMethod = useAuthStore((s) => s.authMethod);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const athleteId = useAuthStore((s) => s.athleteId);
  return sourceFor({ authMethod, isDemoMode, athleteId });
}
