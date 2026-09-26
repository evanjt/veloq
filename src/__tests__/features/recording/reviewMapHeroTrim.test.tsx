/**
 * Scenario: the trim handle is being dragged across a long recording.
 *
 * Expected behaviour: the slider follows the finger while the map follows the
 * handle that was let go, so a frame never pays for re-slicing the track and
 * shipping both halves into the WebView.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { ReviewMapHero } from '@/features/recording/components/ReviewMapHero';

const mockRecordingMapProps = jest.fn();
const mockTrimSliderProps = jest.fn();

jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: (props: Record<string, unknown>) => {
    mockRecordingMapProps(props);
    return null;
  },
}));

jest.mock('@/features/recording/components/TrimSlider', () => ({
  TrimSlider: (props: Record<string, unknown>) => {
    mockTrimSliderProps(props);
    return null;
  },
}));

const hero = (overrides: Record<string, unknown> = {}) =>
  render(
    <ReviewMapHero
      coordinates={[
        [1, 2],
        [1.1, 2],
      ]}
      mapHeight={300}
      topInset={0}
      canTrim
      trimStart={40}
      trimEnd={90}
      mapTrimStart={0}
      mapTrimEnd={120}
      totalDuration={600}
      totalPoints={121}
      onTrimChange={jest.fn()}
      onTrimCommit={jest.fn()}
      onBack={jest.fn()}
      {...overrides}
    />
  );

beforeEach(() => {
  mockRecordingMapProps.mockClear();
  mockTrimSliderProps.mockClear();
});

describe('ReviewMapHero', () => {
  it('draws the map at the released trim, not the one under the finger', () => {
    hero();

    expect(mockRecordingMapProps).toHaveBeenCalledWith(
      expect.objectContaining({ trimStart: 0, trimEnd: 120 })
    );
  });

  it('leaves the slider on the trim under the finger', () => {
    hero();

    expect(mockTrimSliderProps).toHaveBeenCalledWith(
      expect.objectContaining({ startIdx: 40, endIdx: 90 })
    );
  });

  it('gives the map no trim at all when trimming is off', () => {
    hero({ canTrim: false });

    expect(mockRecordingMapProps).toHaveBeenCalledWith(
      expect.objectContaining({ trimStart: undefined, trimEnd: undefined })
    );
    expect(mockTrimSliderProps).not.toHaveBeenCalled();
  });

  it('hands the slider a commit callback of its own', () => {
    const onTrimCommit = jest.fn();
    hero({ onTrimCommit });

    expect(mockTrimSliderProps).toHaveBeenCalledWith(expect.objectContaining({ onTrimCommit }));
  });
});
