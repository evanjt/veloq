import { settings, type FitCourseFile } from 'veloqrs';

import { buildRouteFitFile, buildSectionFitFile } from '@/shared/native/gpxFile';

const file: FitCourseFile = { filename: 'Lake_loop.fit', content: new ArrayBuffer(16) };

describe('FIT course files for a route or section', () => {
  it('hands the engine the route id and returns the file it built unchanged', () => {
    jest.mocked(settings.buildRouteFitCourse).mockReturnValueOnce(file);

    expect(buildRouteFitFile('g1', 'Ride')).toBe(file);
    expect(settings.buildRouteFitCourse).toHaveBeenCalledWith('g1', 'Ride');
  });

  it('hands the engine the section id and returns the file it built unchanged', () => {
    jest.mocked(settings.buildSectionFitCourse).mockReturnValueOnce(file);

    expect(buildSectionFitFile('sec-1', 'Ride')).toBe(file);
    expect(settings.buildSectionFitCourse).toHaveBeenCalledWith('sec-1', 'Ride');
  });

  it('returns null when the trim leaves too little of the line for a course', () => {
    jest.mocked(settings.buildRouteFitCourse).mockReturnValueOnce(null);
    jest.mocked(settings.buildSectionFitCourse).mockReturnValueOnce(null);

    expect(buildRouteFitFile('g1', undefined)).toBeNull();
    expect(buildSectionFitFile('sec-1', undefined)).toBeNull();
  });
});
