import type { ApiWellness } from '@/shared/demo/activity/types';
import { fixtures } from '@/shared/demo/activity/activities';

export function getWellness(params?: { oldest?: string; newest?: string }): ApiWellness[] {
  const { oldest, newest } = params ?? {};
  let result = [...fixtures.wellness];

  if (oldest) {
    result = result.filter((w) => w.id >= oldest);
  }
  if (newest) {
    result = result.filter((w) => w.id <= newest);
  }

  return result;
}
