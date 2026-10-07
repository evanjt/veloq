/**
 * Scenario: a screen registered in the root stack exports its component bare.
 *
 * Expected behaviour: every registered screen's default export is wrapped by
 * `withScreenBoundary`, so a render throw reaches the screen fallback with Retry
 * and Back instead of the global fallback, which has no button.
 */

import { SCREEN_HEADERS } from '@/shared/app/screenHeaders';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const TAB_GROUP = '(tabs)';

describe('registered screens', () => {
  const names = Object.keys(SCREEN_HEADERS).filter((name) => name !== TAB_GROUP);

  it.each(names)('%s default export renders inside a screen boundary', (name) => {
    let screen: { default: { displayName?: string } };
    jest.isolateModules(() => {
      screen = require(`@/app/${name}`);
    });
    expect(screen!.default.displayName).toMatch(/^withScreenBoundary\(/);
  });
});
