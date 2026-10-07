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

jest.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));

describe('getAllSectionDisplayNames', () => {
  it('shows the label the engine sent', () => {
    mockEngine.getSectionSummaries.mockReturnValue({
      summaries: [{ id: 's1', name: 'Section 12', sportTypes: ['Ride'], distanceMeters: 2300 }],
    });
    mockEngine.getAllSectionNames.mockReturnValue({});

    expect(getAllSectionDisplayNames()).toEqual({ s1: 'Section 12' });
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
    mockEngine.getAllSectionNames.mockReturnValue({});

    expect(getAllSectionDisplayNames()).toEqual({});
  });
});
