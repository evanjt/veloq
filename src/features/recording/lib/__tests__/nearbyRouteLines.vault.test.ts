import { followedRouteLine, routeIdUnderPress, unfollowedRouteLines } from '../nearbyRouteLines';

const line = (id: string) => ({
  id,
  points: [
    { lat: 46.5, lng: 6.6 },
    { lat: 46.51, lng: 6.61 },
  ],
});
const routes = [line('a'), line('b'), line('c')];

describe('nearby route lines', () => {
  it('draws every route unfollowed while none is followed', () => {
    const drawn = unfollowedRouteLines(routes, null);
    expect(drawn.features.map((f) => f.properties?.routeId)).toEqual(['a', 'b', 'c']);
    expect(followedRouteLine(routes, null).features).toHaveLength(0);
  });

  it('draws the followed route once, in its own line, and not among the others', () => {
    expect(unfollowedRouteLines(routes, 'b').features.map((f) => f.properties?.routeId)).toEqual([
      'a',
      'c',
    ]);
    expect(followedRouteLine(routes, 'b').features).toHaveLength(1);
  });

  it('draws nothing followed for a route the read did not return', () => {
    expect(followedRouteLine(routes, 'gone').features).toHaveLength(0);
  });

  it('names the route under a tap, and none for a tap that hit nothing', () => {
    expect(routeIdUnderPress({ properties: { routeId: 'b' } })).toBe('b');
    expect(routeIdUnderPress({ properties: {} })).toBeNull();
    expect(routeIdUnderPress(null)).toBeNull();
  });
});
