/**
 * Scenario: the line above the routes and sections lists while a regroup is
 * owed. During an upgrade the regroup waits on the section rebuild, which waits
 * on the elevation download, and the old routes stay on screen meanwhile.
 *
 * Expected behaviour: track work in progress is a moving line; a regroup the
 * engine says is held is a still note naming the hold; a regroup owed and not
 * held is "computing" with a moving indicator; nothing owed is no line.
 */
import type { TFunction } from 'i18next';
import { FfiDetectionHold_Tags, type FfiDetectionHold } from 'veloqrs';

import { routesBannerOf } from '../routesBanner';

jest.mock('veloqrs', () => require('../../../../__tests__/__shared__/veloqrsStub'));

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as unknown as TFunction;

const cutover = { tag: FfiDetectionHold_Tags.Cutover } as FfiDetectionHold;
const elevationWaiting = {
  tag: FfiDetectionHold_Tags.ElevationWaiting,
  inner: { remaining: 37 },
} as FfiDetectionHold;

describe('routesBannerOf', () => {
  it('names a held regroup as a still note, not as routes being computed', () => {
    expect(routesBannerOf({ progress: null, groupsDirty: true, groupsHold: cutover }, t)).toEqual({
      text: 'sections.detectionPaused',
      busy: false,
    });
  });

  it('names the elevation wait the rebuild sits behind, with its count', () => {
    expect(
      routesBannerOf({ progress: null, groupsDirty: true, groupsHold: elevationWaiting }, t)
    ).toEqual({ text: 'sections.detectionHeldElevationWaiting:{"count":37}', busy: false });
  });

  it('says routes are computing, with a moving indicator, while a regroup owed is not held', () => {
    expect(routesBannerOf({ progress: null, groupsDirty: true, groupsHold: undefined }, t)).toEqual(
      { text: 'routesScreen.computingRoutes', busy: true }
    );
  });

  it('puts track work in progress ahead of a held regroup', () => {
    expect(
      routesBannerOf(
        { progress: 'Downloading tracks (2/9)', groupsDirty: true, groupsHold: cutover },
        t
      )
    ).toEqual({ text: 'Downloading tracks (2/9)', busy: true });
  });

  it('shows nothing when no regroup is owed and no track work runs', () => {
    expect(routesBannerOf({ progress: null, groupsDirty: false, groupsHold: undefined }, t)).toBe(
      null
    );
  });
});
