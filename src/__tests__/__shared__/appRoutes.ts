import * as fs from 'fs';
import * as path from 'path';

const APP_DIR = path.join(__dirname, '../../app');

/** The route path a link names, without its scheme, query or trailing slash. */
export function routePathOf(link: string): string {
  return link
    .replace(/^veloq:\/\//, '')
    .replace(/^\/+/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

/** The route files expo-router would try for a path, in the order it tries them. */
export function routeCandidates(routePath: string): string[] {
  if (routePath === '') return ['index.tsx', '(tabs)/index.tsx', '(tabs)/(feed)/index.tsx'];
  const segments = routePath.split('/');
  const group = ['', '(tabs)/'];
  const shapes = [`${routePath}.tsx`, `${routePath}/index.tsx`];
  if (segments.length > 1) {
    const parent = segments.slice(0, -1).join('/');
    // A dynamic segment is a file, or a directory with a layout of its own and an index.
    shapes.push(`${parent}/[id].tsx`, `${parent}/[id]/index.tsx`, `${parent}/[...rest].tsx`);
  }
  return group.flatMap((prefix) => shapes.map((shape) => `${prefix}${shape}`));
}

/** The files under `src/app` a link resolves to, by the rules expo-router uses. */
export function routeFilesFor(link: string): string[] {
  return routeCandidates(routePathOf(link))
    .map((candidate) => path.join(APP_DIR, candidate))
    .filter((file) => fs.existsSync(file));
}
