import { headPreviewIds } from '@/shared/activity/feedHead';

const ride = (id: string) => ({ id, stream_types: ['latlng'] });

describe('headPreviewIds', () => {
  const page = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(ride);

  it('takes the first five rides with a track when the newest page is held', () => {
    const ids = headPreviewIds([{ id: 'x', stream_types: ['watts'] }, ...page], false, []);
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps the held ids when earlier pages are evicted', () => {
    const held = ['n1', 'n2'];
    expect(headPreviewIds(page, true, held)).toBe(held);
  });

  it('is empty with no activities', () => {
    expect(headPreviewIds([], false, [])).toEqual([]);
  });
});
