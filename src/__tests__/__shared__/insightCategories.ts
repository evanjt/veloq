import fs from 'fs';
import path from 'path';

/** The categories the app ranks insights in, as `InsightCategory` declares them. */
export function insightCategories(): string[] {
  const source = fs.readFileSync(path.join(__dirname, '../../features/insights/types.ts'), 'utf8');
  const block = /export type InsightCategory =([^;]*);/.exec(source);
  return [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}
