import { recordingColumnLayout } from '../recordingColumnLayout';

// Measured at font scale 1: header and banners 125, tiles 167, bottom slot 80.
const FIXED = 125 + 167;
const BOTTOM_SLOT = 80;

function inWindow(windowHeight: number) {
  return recordingColumnLayout({
    regionHeight: windowHeight - BOTTOM_SLOT,
    fixedContentHeight: FIXED,
  });
}

it('gives the map what a half-screen split pane has left after the header and tiles', () => {
  expect(inWindow(390)).toEqual({ mapHeight: 18, scrolls: false });
});

it('scrolls with the map at zero when the header and tiles alone overflow the region', () => {
  expect(inWindow(260)).toEqual({ mapHeight: 0, scrolls: true });
});

it('gives the map the rest of a full window', () => {
  expect(inWindow(780)).toEqual({ mapHeight: 408, scrolls: false });
});

it('neither scrolls nor keeps a map when the content exactly fills the region', () => {
  expect(recordingColumnLayout({ regionHeight: FIXED, fixedContentHeight: FIXED })).toEqual({
    mapHeight: 0,
    scrolls: false,
  });
});

it('keeps the map at zero and scrolls before anything is measured but the content', () => {
  expect(recordingColumnLayout({ regionHeight: 0, fixedContentHeight: FIXED })).toEqual({
    mapHeight: 0,
    scrolls: true,
  });
});
