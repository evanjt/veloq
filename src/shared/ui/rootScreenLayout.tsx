/**
 * The root stack's `screenLayout`: a route whose header is laid over its
 * content is read after that header, and a sheet route renders inside
 * `SheetFrame`. Any other route renders as it is.
 */

import React from 'react';

import { SCREEN_HEADERS } from '@/shared/app/screenHeaders';
import { ReadAfterHeader } from '@/shared/ui/ReadAfterHeader';
import { sheetScreenLayout } from '@/shared/ui/SheetFrame';

export function rootScreenLayout(props: {
  route: { name: string };
  children: React.ReactElement;
}): React.ReactElement {
  const screen = sheetScreenLayout(props);
  if (!SCREEN_HEADERS[props.route.name]?.overMap) return screen;
  return <ReadAfterHeader>{screen}</ReadAfterHeader>;
}
