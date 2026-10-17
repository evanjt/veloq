// Metro resolves a bundled image to an asset id that Image takes as its source.
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';
  const source: ImageSourcePropType;
  export default source;
}
