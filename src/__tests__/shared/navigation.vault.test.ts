/**
 * Scenario: a press that only navigates, opening a screen or going back, fires no haptic, and
 * neither does navigation with no tap behind it (a notification, the end of a recording, a
 * redirect).
 *
 * Expected behaviour: navigateTo and goBack navigate and fire nothing, on a first call and a second.
 * They are the only names for a push and a back, so a press handler and a redirect share one.
 * A back with nothing behind the screen, as on a screen a cold link opened as the stack root,
 * replaces to the Feed rather than dispatching a pop nothing handles.
 */

import { router } from 'expo-router';

import * as haptics from '@/shared/ui/haptics';
import * as navigation from '@/shared/app/navigation';
import { goBack, navigateTab, navigateTo, replaceTo } from '@/shared/app/navigation';

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

function expectNoHaptic(): void {
  expect(mockedHaptics.light).not.toHaveBeenCalled();
  expect(mockedHaptics.medium).not.toHaveBeenCalled();
  expect(mockedHaptics.selection).not.toHaveBeenCalled();
  expect(mockedHaptics.success).not.toHaveBeenCalled();
}

describe('navigateTo', () => {
  it('pushes the path and fires no haptic', () => {
    navigateTo('/activity/a1');

    expect(mockedRouter.push).toHaveBeenCalledWith('/activity/a1');
    expectNoHaptic();
  });

  it('pushes a pathname with params unchanged', () => {
    navigateTo({ pathname: '/section/[id]', params: { id: 's1' } });

    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/section/[id]',
      params: { id: 's1' },
    });
    expectNoHaptic();
  });

  it('fires nothing on a second tap either', () => {
    navigateTo('/a');
    navigateTo('/b');

    expect(mockedRouter.push).toHaveBeenCalledTimes(2);
    expectNoHaptic();
  });
});

describe('goBack, from a press', () => {
  it('goes back and fires no haptic', () => {
    goBack();

    expect(mockedRouter.back).toHaveBeenCalledTimes(1);
    expectNoHaptic();
  });

  it('replaces to the Feed and fires no haptic when nothing is behind the screen', () => {
    canGoBack.mockReturnValue(false);

    goBack();

    expect(mockedRouter.back).not.toHaveBeenCalled();
    expect(mockedRouter.replace).toHaveBeenCalledWith('/');
    expectNoHaptic();
  });

  it('fires nothing on a second back either', () => {
    goBack();
    goBack();

    expect(mockedRouter.back).toHaveBeenCalledTimes(2);
    expectNoHaptic();
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
    expectNoHaptic();
  });
});

describe('module surface', () => {
  it('exports one name per move and no second name for a push or a back', () => {
    expect(Object.keys(navigation).sort()).toEqual(
      ['goBack', 'navigateTab', 'navigateTo', 'replaceTo', 'returnTo'].sort()
    );
  });
});
