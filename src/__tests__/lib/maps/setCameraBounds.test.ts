import { buildSetCameraScript } from '@/features/maps/lib/htmlBuilders/mapSurface';

describe('buildSetCameraScript', () => {
  const bounds = { sw: [10, 20] as [number, number], ne: [11, 21] as [number, number] };

  it('fits a bounds camera with its padding and maxZoom', () => {
    const script = buildSetCameraScript({ bounds, padding: 24, maxZoom: 16 });
    expect(script).toContain('fitBounds([[10,20],[11,21]]');
    expect(script).toContain('maxZoom: 16');
    expect(script).toContain('padding: 24');
    expect(script).not.toContain('jumpTo');
  });

  it('animates a bounds camera for the given duration', () => {
    expect(buildSetCameraScript({ bounds }, 300)).toContain('duration: 300');
  });

  it('still jumps for a centre and zoom camera', () => {
    const script = buildSetCameraScript({ center: [1, 2], zoom: 5 });
    expect(script).toContain('jumpTo');
    expect(script).not.toContain('fitBounds');
  });
});
