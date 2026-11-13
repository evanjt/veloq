/**
 * Scenario: the key along the top of the detection preview map.
 * Expected behaviour: it is the map's only key. Before a run it names the current
 * catalogue and the area box. After one it names the diff strip's categories that
 * have sections, each carrying the colour of its lines taken from the layer spec.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';
import { buildPreviewLayers } from '@/features/routes/components/preview/previewMapLayerSpecs';
import { mapPalette } from '@/theme';
import type { PreviewResult } from 'veloqrs';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { longitude: 8.7, latitude: 47.5 },
      { longitude: 8.71, latitude: 47.51 },
    ],
  })
);

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ getGlobalMapStyle: () => 'light' }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const CENTRE = { binKey: '9:27', lat: 47.5, lng: 8.7 };

function lineColour(layerId: string): string {
  const paint = buildPreviewLayers(mapPalette('light'), false, true).find(
    (l) => l.id === layerId
  )?.paint;
  const colour = paint?.['line-color'];
  return Array.isArray(colour) ? (colour[colour.length - 1] as string) : (colour as string);
}

function renderMap(
  over: {
    showCurrent?: boolean;
    showRemoved?: boolean;
    result?: PreviewResult | null;
    retiredOnly?: boolean;
  } = {}
) {
  return render(
    <PreviewMapView
      result={over.result ?? null}
      currentSections={[]}
      centre={CENTRE}
      selectedId={null}
      showCurrent={over.showCurrent ?? true}
      showRemoved={over.showRemoved ?? true}
      onToggleCurrent={jest.fn()}
      onToggleRemoved={jest.fn()}
      onSelect={jest.fn()}
      retiredOnly={over.retiredOnly ?? false}
    />
  );
}

function flatStyle(node: { props: Record<string, unknown> }): Record<string, unknown> {
  const style = node.props.style;
  const parts = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...parts.filter(Boolean));
}

const RESULT = {
  config: {},
  counts: { current: 8, proposed: 9, unchanged: 5, changed: 2, new: 1, gone: 0 },
  sections: [],
  pool: {},
  elapsedMs: 1,
} as unknown as PreviewResult;

describe('preview map legend chips', () => {
  it('is the current catalogue and the area box alone before a run', async () => {
    const tree = await renderMap();

    expect(tree.getByTestId('preview-layer-current')).toBeTruthy();
    expect(tree.getByTestId('preview-layer-area')).toBeTruthy();
    for (const id of ['unchanged', 'changed', 'new', 'gone']) {
      expect(tree.queryByTestId(`preview-layer-${id}`)).toBeNull();
    }
  });

  it('lists a diff category only while the run holds sections of it', async () => {
    const tree = await renderMap({ result: RESULT });

    for (const id of ['unchanged', 'changed', 'new']) {
      expect(tree.getByTestId(`preview-layer-${id}`)).toBeTruthy();
    }
    expect(tree.queryByTestId('preview-layer-gone')).toBeNull();
  });

  it('gives each category the colour of the line it keys', async () => {
    const tree = await renderMap({ result: RESULT });

    expect(flatStyle(tree.getByTestId('preview-layer-changed-swatch')).backgroundColor).toBe(
      lineColour('proposed-line')
    );
    expect(flatStyle(tree.getByTestId('preview-layer-new-swatch')).borderColor).toBe(
      mapPalette('light').layer.added
    );
    expect(flatStyle(tree.getByTestId('preview-layer-unchanged-swatch')).borderColor).not.toBe(
      flatStyle(tree.getByTestId('preview-layer-changed-swatch')).borderColor
    );
  });

  it('shows an off current chip as off rather than as a slightly different grey', async () => {
    const on = flatStyle((await renderMap()).getByTestId('preview-layer-current-swatch'));
    const off = flatStyle(
      (await renderMap({ showCurrent: false })).getByTestId('preview-layer-current-swatch')
    );

    expect(off.backgroundColor).not.toBe(on.backgroundColor);
    expect(off.backgroundColor).toBe('transparent');
  });

  it('reports the current chip as a switch and a category as a plain key entry', async () => {
    const tree = await renderMap({ result: RESULT });

    expect(tree.getByTestId('preview-layer-current').props.accessibilityRole).toBe('switch');
    expect(tree.getByTestId('preview-layer-changed').props.accessibilityRole).not.toBe('switch');
  });

  it('keeps the key in one row that scrolls, so it never wraps over the lines', async () => {
    const tree = await renderMap({ result: RESULT });

    const key = tree.getByTestId('preview-key');
    expect(key.props.horizontal).toBe(true);
  });
});

describe('preview map legend chips on the retired layer alone', () => {
  it('leaves out the settings preview statuses, Removed and Proposed', async () => {
    const tree = await renderMap({ retiredOnly: true });

    expect(tree.queryByTestId('preview-layer-removed')).toBeNull();
    expect(tree.queryByTestId('preview-layer-proposed')).toBeNull();
    expect(tree.getByTestId('preview-layer-current')).toBeTruthy();
  });
});
