/**
 * Scenario: the athlete sends a section to the Apple Watch guide while the
 * phone's notification permission is still askable.
 *
 * Expected behaviour: the section is handed to the watch module, and the system
 * notification request is raised exactly once after it. With the permission
 * already granted the request is not raised again, and without the watch module
 * nothing is sent and nothing is requested.
 */

import { FfiNearbyKind, routes } from 'veloqrs';
import * as Notifications from 'expo-notifications';
import { requireOptionalNativeModule } from 'expo-modules-core';

import {
  isWatchLinkAvailable,
  isWatchLinkEnabled,
  sendSectionGuide,
  sendSectionToWatch,
  setWatchLinkEnabled,
} from '@/shared/native/watchLink';

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

const mockRequireNativeModule = jest.mocked(requireOptionalNativeModule);
const mockGuidePayload = jest.mocked(routes.getGuidePayload);
const mockModule = { state: jest.fn(), sendSection: jest.fn() };
const getPermissions = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissions = Notifications.requestPermissionsAsync as jest.Mock;

beforeEach(() => {
  mockModule.sendSection.mockReset();
  mockGuidePayload.mockReset();
  mockModule.state.mockReset().mockReturnValue({ enabled: true });
  mockRequireNativeModule.mockReset().mockReturnValue(mockModule as never);
  getPermissions.mockReset().mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  requestPermissions.mockReset().mockResolvedValue({ status: 'granted', canAskAgain: true });
});

describe('sendSectionToWatch', () => {
  it('sends the section and raises the notification request once when it is askable', async () => {
    await expect(sendSectionToWatch('{"name":"Hill"}')).resolves.toBe(true);

    expect(mockRequireNativeModule).toHaveBeenCalledWith('VeloqWatch');
    expect(mockModule.sendSection).toHaveBeenCalledTimes(1);
    expect(mockModule.sendSection).toHaveBeenCalledWith('{"name":"Hill"}');
    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('does not raise the request again when the permission is already granted', async () => {
    getPermissions.mockResolvedValue({ status: 'granted', canAskAgain: true });

    await sendSectionToWatch('{"name":"Hill"}');

    expect(mockModule.sendSection).toHaveBeenCalledTimes(1);
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('sends nothing and raises no request while the watch link is switched off', async () => {
    mockModule.state.mockReturnValue({ enabled: false });

    await expect(sendSectionToWatch('{"name":"Hill"}')).resolves.toBe(false);

    expect(mockModule.sendSection).not.toHaveBeenCalled();
    expect(getPermissions).not.toHaveBeenCalled();
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('sends nothing and raises no request without the watch module', async () => {
    mockRequireNativeModule.mockReturnValue(null as never);

    await expect(sendSectionToWatch('{"name":"Hill"}')).resolves.toBe(false);

    expect(mockModule.sendSection).not.toHaveBeenCalled();
    expect(getPermissions).not.toHaveBeenCalled();
    expect(requestPermissions).not.toHaveBeenCalled();
  });
});

describe('watch link switch and section guide', () => {
  it('sends the engine guide payload, never the stored line, and raises the request once', async () => {
    const stored = Array.from({ length: 3000 }, (_, i) => ({ lat: 46 + i * 1e-5, lng: 6.6 }));
    const simplified = stored
      .filter((_, i) => i % 30 === 0)
      .map(({ lat, lng }) => ({ latitude: lat, longitude: lng }));
    const reply = JSON.stringify({ name: 'Hill', line: simplified });
    mockGuidePayload.mockReturnValue(reply);

    await expect(sendSectionGuide('s1')).resolves.toBe(true);

    expect(mockGuidePayload).toHaveBeenCalledWith(FfiNearbyKind.Section, 's1');
    const sent = JSON.parse(mockModule.sendSection.mock.calls[0][0]);
    expect(sent.line.length).toBeLessThan(200);
    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a section the engine has no line for', async () => {
    mockGuidePayload.mockReturnValue(undefined);

    await expect(sendSectionGuide('s1')).resolves.toBe(false);

    expect(mockModule.sendSection).not.toHaveBeenCalled();
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('resolves false and raises no request when the native send throws', async () => {
    mockModule.sendSection.mockImplementation(() => {
      throw new Error('payload too large');
    });

    await expect(sendSectionToWatch('{"name":"Hill"}')).resolves.toBe(false);

    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('switches the link through the watch module and reads it back', () => {
    const setEnabled = jest.fn();
    mockRequireNativeModule.mockReturnValue({ ...mockModule, setEnabled } as never);

    setWatchLinkEnabled(true);

    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(isWatchLinkAvailable()).toBe(true);
    expect(isWatchLinkEnabled()).toBe(true);
  });

  it('reports the link unavailable and off without the watch module', () => {
    mockRequireNativeModule.mockReturnValue(null as never);

    setWatchLinkEnabled(true);

    expect(isWatchLinkAvailable()).toBe(false);
    expect(isWatchLinkEnabled()).toBe(false);
  });
});
