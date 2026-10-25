/**
 * Scenario: the athlete prefers one of two sections on the same ground.
 *
 * Expected behaviour: the engine is asked with the kept section first, a notice offers Undo, and
 * Undo asks the opposite way round. A refusal is said and offers no Undo.
 */

import { preferSectionWithUndo } from '@/features/routes/lib/sectionVisibility';

const mockPreferSection = jest.fn();
const mockShowNotice = jest.fn();
const mockInform = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ preferSection: mockPreferSection }),
}));
jest.mock('@/shared/ui/Notice', () => ({ showNotice: (n: unknown) => mockShowNotice(n) }));
jest.mock('@/shared/ui/dialog', () => ({ inform: (d: unknown) => mockInform(d) }));

const t = ((key: string) => key) as never;

describe('preferSectionWithUndo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps the first id, and Undo keeps the second', async () => {
    mockPreferSection.mockResolvedValue(true);

    expect(await preferSectionWithUndo('current', 'retired', 'Lake Loop', t)).toBe(true);
    expect(mockPreferSection).toHaveBeenCalledWith('current', 'retired');

    const notice = mockShowNotice.mock.calls[0][0];
    expect(notice.action.label).toBe('common.undo');
    await notice.action.onPress();

    expect(mockPreferSection).toHaveBeenLastCalledWith('retired', 'current');
  });

  it('says a refusal and offers no Undo', async () => {
    mockPreferSection.mockResolvedValue(false);

    expect(await preferSectionWithUndo('current', 'retired', 'Lake Loop', t)).toBe(false);

    expect(mockInform).toHaveBeenCalledTimes(1);
    expect(mockShowNotice).not.toHaveBeenCalled();
  });

  it('says a refused Undo rather than showing it done', async () => {
    mockPreferSection.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await preferSectionWithUndo('current', 'retired', 'Lake Loop', t);

    await mockShowNotice.mock.calls[0][0].action.onPress();

    expect(mockInform).toHaveBeenCalledTimes(1);
  });
});
