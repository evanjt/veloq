import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { TerrainSnapshotWebView } from '@/features/maps/components/TerrainSnapshotWebView';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { background: '#ABCDEF' } }),
}));

describe('TerrainSnapshotWebView', () => {
  it('covers its live map surface with an opaque fill so place labels never show through the feed', () => {
    const { getByTestId } = render(<TerrainSnapshotWebView suspended={false} />);
    const cover = getByTestId('terrain-snapshot-cover');
    const style = StyleSheet.flatten(cover.props.style);
    expect(style.backgroundColor).toBe('#ABCDEF');
    expect(style.opacity ?? 1).toBe(1);
  });
});
