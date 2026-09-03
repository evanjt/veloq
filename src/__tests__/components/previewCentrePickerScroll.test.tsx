/**
 * Scenario: three area chips, the third cut mid-word by the screen edge at both
 * 780 dp and 640 dp. The picker scrolls and nothing says so, so the cut reads
 * as a layout bug rather than as more content.
 *
 * Expected behaviour: a fade over the edge the content runs off, on the side it
 * runs off, and nothing at all when every chip already fits.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { PreviewCentrePicker } from '@/features/routes/components/preview/PreviewCentrePicker';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('expo-linear-gradient', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { LinearGradient: View };
});

function centre(binKey: string) {
  return {
    binKey,
    lat: 1,
    lng: 2,
    visitTotal: 10,
    sectionCount: 3,
    source: 'visits' as const,
  };
}

function renderPicker(count: number) {
  const centres = Array.from({ length: count }, (_, i) => centre(`b${i}`));
  const labels = centres.map((c, i) => ({ binKey: c.binKey, label: null, fallbackNumber: i + 1 }));
  return render(
    <PreviewCentrePicker
      centres={centres}
      labels={labels}
      selectedBinKey="b0"
      onSelect={jest.fn()}
    />
  );
}

/** The measurements a real layout pass would deliver. */
function measure(
  tree: ReturnType<typeof render>,
  { viewport, content, offset }: { viewport: number; content: number; offset: number }
) {
  const picker = tree.getByTestId('preview-centre-picker');
  fireEvent(picker, 'layout', { nativeEvent: { layout: { width: viewport, height: 55 } } });
  fireEvent(picker, 'contentSizeChange', content, 55);
  fireEvent.scroll(picker, {
    nativeEvent: {
      contentOffset: { x: offset, y: 0 },
      contentSize: { width: content, height: 55 },
      layoutMeasurement: { width: viewport, height: 55 },
    },
  });
}

describe('the centre picker edge', () => {
  it('fades the trailing edge when a chip is cut by it', () => {
    const tree = renderPicker(3);
    measure(tree, { viewport: 360, content: 520, offset: 0 });
    expect(tree.queryByTestId('preview-centre-fade-end')).not.toBeNull();
  });

  it('says nothing when every chip fits', () => {
    const tree = renderPicker(2);
    measure(tree, { viewport: 360, content: 300, offset: 0 });
    expect(tree.queryByTestId('preview-centre-fade-end')).toBeNull();
    expect(tree.queryByTestId('preview-centre-fade-start')).toBeNull();
  });

  it('drops the trailing fade at the end of the run', () => {
    const tree = renderPicker(3);
    measure(tree, { viewport: 360, content: 520, offset: 160 });
    expect(tree.queryByTestId('preview-centre-fade-end')).toBeNull();
  });

  it('fades the leading edge once the first chip is behind it', () => {
    const tree = renderPicker(3);
    measure(tree, { viewport: 360, content: 520, offset: 0 });
    expect(tree.queryByTestId('preview-centre-fade-start')).toBeNull();
    measure(tree, { viewport: 360, content: 520, offset: 80 });
    expect(tree.queryByTestId('preview-centre-fade-start')).not.toBeNull();
  });

  it('shows nothing before the first layout, rather than a fade over nothing', () => {
    const tree = renderPicker(3);
    expect(tree.queryByTestId('preview-centre-fade-end')).toBeNull();
    expect(tree.queryByTestId('preview-centre-fade-start')).toBeNull();
  });
});
