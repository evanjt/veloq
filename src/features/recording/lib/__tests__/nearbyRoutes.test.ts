import { nearbyRouteIds, NEARBY_ROUTE_RADIUS_METRES } from '../nearbyRoutes';

const box = (minLat: number, maxLat: number, minLng: number, maxLng: number) => ({
  minLat,
  maxLat,
  minLng,
  maxLng,
});

describe('nearbyRouteIds', () => {
  const here = { latitude: 46.5, longitude: 6.6 };

  it('lists a route whose bounds contain the location', () => {
    const groups = [{ id: 'inside', bounds: box(46.4, 46.6, 6.5, 6.7) }];
    expect(nearbyRouteIds(groups, here)).toEqual(['inside']);
  });

  it('includes a route that ends within the radius of the location and drops one beyond it', () => {
    const degrees = (NEARBY_ROUTE_RADIUS_METRES * 0.5) / 111_000;
    const close = { id: 'close', bounds: box(46.5 + degrees, 46.6, 6.5, 6.7) };
    const far = { id: 'far', bounds: box(47.5, 47.6, 6.5, 6.7) };
    expect(nearbyRouteIds([far, close], here)).toEqual(['close']);
  });

  it('orders the nearest bounds first, a containing route before an outside one', () => {
    const degrees = (NEARBY_ROUTE_RADIUS_METRES * 0.5) / 111_000;
    const outside = { id: 'outside', bounds: box(46.5 + degrees, 46.6, 6.5, 6.7) };
    const inside = { id: 'inside', bounds: box(46.4, 46.6, 6.5, 6.7) };
    expect(nearbyRouteIds([outside, inside], here)).toEqual(['inside', 'outside']);
  });

  it('leaves out a route with no bounds', () => {
    expect(nearbyRouteIds([{ id: 'unknown', bounds: null }], here)).toEqual([]);
  });

  it('is empty before a location is known', () => {
    expect(nearbyRouteIds([{ id: 'a', bounds: box(46, 47, 6, 7) }], null)).toEqual([]);
  });

  it('measures longitude by latitude, so a degree is shorter far from the equator', () => {
    const north = { latitude: 70, longitude: 20 };
    // 0.02 degrees of longitude at 70N is about 760 m, inside the radius.
    const group = { id: 'g', bounds: box(69.9, 70.1, 20.02, 20.1) };
    expect(nearbyRouteIds([group], north)).toEqual(['g']);
  });
});
