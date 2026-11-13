import { regenerateNotification } from '../regenerateNotification';

const categories = { sectionPr: true, fitnessMilestone: false };

describe('regenerateNotification', () => {
  it('hands the engine text for the activity to the poster unchanged', async () => {
    const build = jest
      .fn()
      .mockReturnValue({ title: 'Morning Ride', body: 'New best on Hill: 4:10' });
    const post = jest.fn().mockResolvedValue(undefined);

    const posted = await regenerateNotification('a1', 'Morning Ride', { build, post, categories });

    expect(build).toHaveBeenCalledWith('a1', 'Morning Ride', true, false);
    expect(post).toHaveBeenCalledWith('a1', 'Morning Ride', 'New best on Hill: 4:10', undefined);
    expect(posted).toEqual({ title: 'Morning Ride', body: 'New best on Hill: 4:10' });
  });

  it.each([[undefined], [{ title: 'Ride', body: '' }]])(
    'posts nothing when the engine has no text (%p)',
    async (built) => {
      const post = jest.fn();
      const result = await regenerateNotification('a1', 'Ride', {
        build: () => built,
        post,
        categories,
      });
      expect(result).toBeNull();
      expect(post).not.toHaveBeenCalled();
    }
  );
});
