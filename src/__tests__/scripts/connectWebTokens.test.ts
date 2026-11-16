/**
 * Scenario: the connect page reads a desktop scale from the token file, not the phone's type roles.
 *
 * Expected behaviour: `renderCss` emits each `web` entry as a `--web-*` custom property.
 */

import { renderCss, type TokenFile } from '../../../scripts/lib/colourTokens';

const file = {
  color: { themes: [{ id: 'light' }], tokens: [{ name: 'ink', value: { light: '#111111' } }] },
  web: {
    type: [{ name: 'body', fontSize: '14px', lineHeight: '20px', fontWeight: 400 }],
    size: [{ name: 'row', value: '32px' }],
    radius: [{ name: 'md', value: '6px' }],
    layout: [{ name: 'sidebar', value: '232px' }],
    numerals: 'tabular-nums',
  },
} as unknown as TokenFile;

it('emits the desktop scale as --web-* custom properties', () => {
  const css = renderCss(file, { light: { ink: '#111111' }, dark: {} }, { light: {}, dark: {} }, []);

  expect(css).toContain('--web-type-body-size: 14px;');
  expect(css).toContain('--web-type-body-line: 20px;');
  expect(css).toContain('--web-type-body-weight: 400;');
  expect(css).toContain('--web-size-row: 32px;');
  expect(css).toContain('--web-radius-md: 6px;');
  expect(css).toContain('--web-layout-sidebar: 232px;');
  expect(css).toContain('--web-numerals: tabular-nums;');
});
