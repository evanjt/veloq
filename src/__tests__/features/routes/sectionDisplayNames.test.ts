/**
 * Scenario: the engine serves a section's name, the numbered label when the
 * section has none of its own, and a summary can still arrive with no name.
 *
 * Expected behaviour: the name the engine sent is the one shown, and a section
 * with no name is left out rather than described from its terrain.
 */
import { getAllSectionDisplayNames } from '@/features/routes/lib/sectionDisplayNames';

const mockEngine = {
  getSectionSummaries: jest.fn(),
  getAllSectionNames: jest.fn(),
};

jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));

describe('getAllSectionDisplayNames', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the label the engine sent', () => {
    mockEngine.getSectionSummaries.mockReturnValue({
      summaries: [{ id: 's1', name: 'Section 12', sportTypes: ['Ride'], distanceMeters: 2300 }],
    });

    expect(getAllSectionDisplayNames()).toEqual({ s1: 'Section 12' });
  });

  it('takes the name from the summary alone and makes no second read', () => {
    mockEngine.getAllSectionNames.mockReturnValue({ s1: 'Not the summary name' });
    mockEngine.getSectionSummaries.mockReturnValue({
      summaries: [
        { id: 's1', name: 'Col du Pillon' },
        { id: 's2', name: 'Section 3' },
      ],
    });

    expect(getAllSectionDisplayNames()).toEqual({ s1: 'Col du Pillon', s2: 'Section 3' });
    expect(mockEngine.getAllSectionNames).not.toHaveBeenCalled();
  });

  it('leaves a section with no name out instead of describing its terrain', () => {
    mockEngine.getSectionSummaries.mockReturnValue({
      summaries: [
        {
          id: 's2',
          sportTypes: ['Ride'],
          distanceMeters: 2300,
          klass: 'climb',
          maxGradePercent: 6.3,
        },
      ],
    });

    expect(getAllSectionDisplayNames()).toEqual({});
  });
});
