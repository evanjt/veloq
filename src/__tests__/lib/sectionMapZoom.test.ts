/**
 * Regression guard for US-D3: the section detail map must clamp zoom so short
 * sections don't over-zoom past street level. The clamp is enforced by the
 * Camera's maxZoomLevel prop; if that prop is removed or loosened, a short
 * 200m section can zoom in past level 18 where MapLibre tiles become grainy.
 *
 * Static source assertion rather than a runtime check — we don't need to
 * render MapLibre to verify a prop literal, and the cost of a missed
 * regression (broken detail view for short sections) is worth the guard.
 */
import fs from 'fs';
import path from 'path';

describe('US-D3: section map zoom clamp', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../components/routes/SectionMapView.tsx'),
    'utf8'
  );

  it('Camera enforces maxZoom of 16', () => {
    const match = source.match(/maxZoom=\{(\d+)\}/);
    expect(match).not.toBeNull();
    const max = Number(match![1]);
    expect(max).toBeLessThanOrEqual(16);
  });

  it('Camera has an initialViewState bounds prop so short sections auto-fit', () => {
    expect(source).toContain('initialViewState={');
    expect(source).toContain('bounds: toLngLatBounds(bounds)');
  });
});
