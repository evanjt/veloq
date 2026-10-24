#!/usr/bin/env npx tsx
/**
 * Copy the widget PNGs the widgets store shot draws from a capture script's
 * output into the raw capture tree.
 *
 *   npx tsx scripts/copy-widget-captures.ts <android|ios> <captures dir> <raw root>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { WIDGET_PLACEMENTS, widgetDir, type WidgetPlatform } from './store-panels';

const [platform, from, rawRoot] = process.argv.slice(2);
if ((platform !== 'android' && platform !== 'ios') || !from || !rawRoot) {
  throw new Error('usage: copy-widget-captures.ts <android|ios> <captures dir> <raw root>');
}
const dest = widgetDir(path.resolve(rawRoot), platform as WidgetPlatform);
fs.mkdirSync(dest, { recursive: true });
for (const placement of WIDGET_PLACEMENTS) {
  const file = placement.file[platform as WidgetPlatform];
  const source = path.join(from, file);
  if (!fs.existsSync(source)) throw new Error(`${source} was not captured`);
  fs.copyFileSync(source, path.join(dest, file));
}
console.log(`copied ${WIDGET_PLACEMENTS.length} widget captures into ${dest}`);
