/**
 * Scenario: a tap that opens a screen or goes back is felt, and navigation with no tap behind it
 * (a notification, the end of a recording, a redirect) is silent.
 *
 * Expected behaviour: tapTo and tapBack fire one light impact and then navigate, and navigateTo,
 * replaceTo and navigateTab fire none. A back with nothing behind the screen, as on a screen a cold
 * link opened as the stack root, replaces to the Feed rather than dispatching a pop nothing handles.
 */

import { router } from 'expo-router';

import * as haptics from '@/shared/ui/haptics';
import {
  goBack,
  navigateTab,
  navigateTo,
  replaceTo,
  tapBack,
  tapTo,
} from '@/shared/app/navigation';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

const mockedRouter = router as jest.Mocked<typeof router>;
const mockedHaptics = haptics as jest.Mocked<typeof haptics>;

let canGoBack: jest.SpyInstance;

beforeEach(() => {
  canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(true);
});

afterEach(() => {
  canGoBack.mockRestore();
  jest.resetAllMocks();
});

describe('tapTo', () => {
  it('fires one light impact and then pushes the path', () => {
    const order: string[] = [];
    mockedHaptics.light.mockImplementation(() => void order.push('light'));
    mockedRouter.push.mockImplementation(() => void order.push('push'));

    tapTo('/activity/a1');

    expect(mockedHaptics.light).toHaveBeenCalledTimes(1);
    expect(mockedRouter.push).toHaveBeenCalledWith('/activity/a1');
    expect(order).toEqual(['light', 'push']);
  });

  it('pushes a pathname with params unchanged', () => {
    tapTo({ pathname: '/section/[id]', params: { id: 's1' } });

    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/section/[id]',
      params: { id: 's1' },
    });
    expect(mockedHaptics.light).toHaveBeenCalledTimes(1);
  });

  it('fires once per call on a second tap', () => {
    tapTo('/a');
    tapTo('/b');

    expect(mockedHaptics.light).toHaveBeenCalledTimes(2);
    expect(mockedRouter.push).toHaveBeenCalledTimes(2);
  });
});

describe('tapBack', () => {
  it('fires one light impact and then goes back', () => {
    const order: string[] = [];
    mockedHaptics.light.mockImplementation(() => void order.push('light'));
    mockedRouter.back.mockImplementation(() => void order.push('back'));

    tapBack();

    expect(mockedHaptics.light).toHaveBeenCalledTimes(1);
    expect(mockedRouter.back).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['light', 'back']);
  });

  it('fires one light impact and replaces to the Feed when nothing is behind the screen', () => {
    canGoBack.mockReturnValue(false);
    const order: string[] = [];
    mockedHaptics.light.mockImplementation(() => void order.push('light'));
    mockedRouter.replace.mockImplementation(() => void order.push('replace'));

    tapBack();

    expect(mockedRouter.back).not.toHaveBeenCalled();
    expect(mockedRouter.replace).toHaveBeenCalledWith('/');
    expect(order).toEqual(['light', 'replace']);
  });
});

describe('goBack', () => {
  it('pops once and never replaces when there is history', () => {
    goBack();

    expect(mockedRouter.back).toHaveBeenCalledTimes(1);
    expect(mockedRouter.replace).not.toHaveBeenCalled();
    expect(mockedHaptics.light).not.toHaveBeenCalled();
  });

  it('replaces to the Feed and never pops when the screen is the stack root', () => {
    canGoBack.mockReturnValue(false);

    goBack();

    expect(mockedRouter.back).not.toHaveBeenCalled();
    expect(mockedRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockedRouter.replace).toHaveBeenCalledWith('/');
  });

  it('reads the history again on a second call', () => {
    canGoBack.mockReturnValueOnce(true).mockReturnValueOnce(false);

    goBack();
    goBack();

    expect(mockedRouter.back).toHaveBeenCalledTimes(1);
    expect(mockedRouter.replace).toHaveBeenCalledTimes(1);
  });
});

describe('programmatic navigation', () => {
  it('stays silent for navigateTo, replaceTo and navigateTab', () => {
    navigateTo('/recording/review');
    replaceTo('/');
    navigateTab('/map');

    expect(mockedRouter.push).toHaveBeenCalledWith('/recording/review');
    expect(mockedRouter.replace).toHaveBeenCalledWith('/');
    expect(mockedRouter.navigate).toHaveBeenCalledWith('/map');
    expect(mockedHaptics.light).not.toHaveBeenCalled();
    expect(mockedHaptics.selection).not.toHaveBeenCalled();
    expect(mockedHaptics.medium).not.toHaveBeenCalled();
  });
});
