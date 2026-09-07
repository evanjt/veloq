import React from 'react';
import { render } from '@testing-library/react-native';

import { EngineInitBanner } from '@/shared/app/EngineInitBanner';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { InitOutcome } from '../__shared__/veloqrsStub';

type EngineStatusReason = Parameters<
  ReturnType<typeof useEngineStatus.getState>['setInitFailureReason']
>[0];

/**
 * Scenario: the engine will not open. A database written by a newer build is
 * fixed by updating the app, a file another connection holds fixes itself, and
 * a directory nothing can be written to needs space or permission. All three
 * showed the same sentence.
 * Expected behaviour: the banner names the reason the engine recorded, and
 * falls back to the general line for a reason this bundle has no string for.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * The stub's enum is a separate declaration from the generated one the store
 * is typed against, and `ffiEnumStub.test.ts` is what holds the two together.
 */
function failedWith(reason: InitOutcome | null) {
  useEngineStatus.setState({
    initFailed: true,
    initFailureReason: reason as unknown as EngineStatusReason,
  });
}

describe('EngineInitBanner', () => {
  beforeEach(() => {
    useEngineStatus.setState({ initFailed: false, initFailureReason: null });
  });

  it('stays hidden while the engine is open', () => {
    const { queryByTestId } = render(<EngineInitBanner />);
    expect(queryByTestId('engine-init-banner')).toBeNull();
  });

  it.each([
    [InitOutcome.Busy, 'engine.initReason.busy'],
    [InitOutcome.ForwardSchema, 'engine.initReason.forwardSchema'],
    [InitOutcome.StorageUnavailable, 'engine.initReason.storageUnavailable'],
    [InitOutcome.Failed, 'engine.initReason.failed'],
  ])('names reason %s with its own line', (reason, key) => {
    failedWith(reason);
    const { getByText } = render(<EngineInitBanner />);
    expect(getByText(key)).toBeTruthy();
  });

  it('falls back to the general line when no reason was recorded', () => {
    failedWith(null);
    const { getByText } = render(<EngineInitBanner />);
    expect(getByText('engine.initFailed')).toBeTruthy();
  });

  /** An engine newer than the bundle answers with a variant that has no string. */
  it('falls back to the general line for a reason it has no string for', () => {
    failedWith(99 as InitOutcome);
    const { getByText } = render(<EngineInitBanner />);
    expect(getByText('engine.initFailed')).toBeTruthy();
  });

  /** Opened is not a failure, and must never reach the banner as one. */
  it('shows the general line rather than a reason when the engine opened', () => {
    failedWith(InitOutcome.Opened);
    const { getByText } = render(<EngineInitBanner />);
    expect(getByText('engine.initFailed')).toBeTruthy();
  });
});
