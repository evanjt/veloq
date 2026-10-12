import type { TFunction } from 'i18next';
import { inform } from '@/shared/ui/dialog';

/**
 * Says a section write the engine refused was not made.
 *
 * The visibility and accept delegates answer false rather than throwing, so
 * the caller holds no error to classify and the line is the database one. A
 * caller shows this in place of whatever it would have shown on success.
 */
export function informSectionWriteRefused(t: TFunction): void {
  inform({ title: t('sections.changeFailedTitle'), message: t('engine.failure.database') });
}
