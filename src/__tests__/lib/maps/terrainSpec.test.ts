import { buildSubjectTerrain } from '@/features/maps/lib/terrainSpec';
import { TERRAIN_3D_CONFIG } from '@/features/maps/components/mapStyles';

describe('buildSubjectTerrain', () => {
  it('names the subject line and the default tilt, unpinned', () => {
    expect(buildSubjectTerrain({ subjectSource: 'route' })).toEqual({
      exaggeration: TERRAIN_3D_CONFIG.defaultExaggeration,
      pitch: TERRAIN_3D_CONFIG.defaultPitch,
      subjectSource: 'route',
      cameraPinned: false,
    });
  });

  it('carries a restored tilt and a pinned camera', () => {
    expect(buildSubjectTerrain({ subjectSource: 'ride', pitch: 41, pinned: true })).toEqual(
      expect.objectContaining({ pitch: 41, cameraPinned: true, subjectSource: 'ride' })
    );
  });
});
