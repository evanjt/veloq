import { getNextStyle, getStyleIcon } from '@/features/maps/components/mapStyles';

describe('getNextStyle', () => {
  it('steps light, dark, satellite, light when satellite can be drawn', () => {
    expect(getNextStyle('light', { satellite: true })).toBe('dark');
    expect(getNextStyle('dark', { satellite: true })).toBe('satellite');
    expect(getNextStyle('satellite', { satellite: true })).toBe('light');
  });

  vaultIt('skips satellite from dark when satellite cannot be drawn', () => {
    expect(getNextStyle('dark', { satellite: false })).toBe('light');
  });

  it('never returns satellite when it cannot be drawn, from any style', () => {
    expect(getNextStyle('light', { satellite: false })).toBe('dark');
    expect(getNextStyle('satellite', { satellite: false })).toBe('light');
  });
});

describe('getStyleIcon', () => {
  vaultIt('names the style a tap draws', () => {
    expect(getStyleIcon('dark')).toBe('weather-night');
    expect(getStyleIcon('satellite')).toBe('satellite-variant');
    expect(getStyleIcon('light')).toBe('weather-sunny');
  });

  vaultIt('names the light style when a dark theme offline steps back to it', () => {
    expect(getStyleIcon(getNextStyle('dark', { satellite: false }))).toBe('weather-sunny');
  });
});
