import { deviceName } from '@/features/settings/lib/remoteLinkSession';

jest.mock('veloqrs');
jest.mock('expo-keep-awake', () => ({
  ...jest.requireActual('expo-keep-awake'),
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));

describe('the name the phone gives a linked browser', () => {
  it('joins the manufacturer and model', () => {
    expect(deviceName({ Brand: 'acme', Model: 'Trail 7' })).toBe('acme Trail 7');
  });

  it('does not repeat a manufacturer the model already starts with', () => {
    expect(deviceName({ Brand: 'Google', Model: 'Google Pixel 8' })).toBe('Google Pixel 8');
  });

  it('falls back to what is present, and to blank when nothing is', () => {
    expect(deviceName({ Model: 'Pixel 8' })).toBe('Pixel 8');
    expect(deviceName({ Brand: 'Acme' })).toBe('Acme');
    expect(deviceName(undefined)).toBe('');
  });
});
