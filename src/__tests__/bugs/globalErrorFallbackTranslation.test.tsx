import React from 'react';
import { render } from '@testing-library/react-native';

import { i18n, initializeI18n } from '@/i18n';
import { GlobalErrorBoundary } from '@/shared/ui/GlobalErrorBoundary';

function Broken(): React.ReactElement {
  throw new Error('render failed');
}

function renderFallback() {
  return render(
    <GlobalErrorBoundary>
      <Broken />
    </GlobalErrorBoundary>
  );
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  jest.restoreAllMocks();
});

describe('the global error fallback', () => {
  it('uses the initialized German translations without a provider', async () => {
    await initializeI18n('de-DE');

    const { getByText } = renderFallback();

    expect(getByText(i18n.t('emptyState.error.title'))).toBeTruthy();
    expect(getByText(i18n.t('errorState.closeAndReopen'))).toBeTruthy();
    expect(i18n.t('errorState.closeAndReopen')).not.toBe('errorState.closeAndReopen');
  });

  it('uses English before translation initialization', () => {
    jest.replaceProperty(i18n, 'isInitialized', false);

    const { getByText } = renderFallback();

    expect(getByText('Something went wrong')).toBeTruthy();
    expect(getByText('Close and reopen the app to continue.')).toBeTruthy();
  });

  it('uses English when translation throws', () => {
    jest.replaceProperty(i18n, 'isInitialized', true);
    jest.spyOn(i18n, 't').mockImplementation(() => {
      throw new Error('translation failed');
    });

    const { getByText } = renderFallback();

    expect(getByText('Something went wrong')).toBeTruthy();
    expect(getByText('Close and reopen the app to continue.')).toBeTruthy();
  });

  it('uses English when translation returns its key', () => {
    jest.replaceProperty(i18n, 'isInitialized', true);
    jest.spyOn(i18n, 't').mockImplementation(((key: string) => key) as typeof i18n.t);

    const { getByText } = renderFallback();

    expect(getByText('Something went wrong')).toBeTruthy();
    expect(getByText('Close and reopen the app to continue.')).toBeTruthy();
  });
});
