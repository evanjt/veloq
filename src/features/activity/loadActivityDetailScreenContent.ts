export function loadActivityDetailScreenContent() {
  const { ActivityDetailScreenContent } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./components/ActivityDetailScreenContent') as typeof import('./components/ActivityDetailScreenContent');
  return ActivityDetailScreenContent;
}
