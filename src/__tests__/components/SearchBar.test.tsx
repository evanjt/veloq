/**
 * Scenario: the feed, routes and sections lists share one search bar.
 *
 * Expected behaviour: typing keeps the athlete's case, the keyboard follows the
 * app theme, and the clear button appears only with text and empties the field.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SearchBar } from '@/shared/ui/SearchBar';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => `t:${key}` }),
}));

describe('SearchBar', () => {
  it('does not capitalise what is typed and sets the field up for search', () => {
    const { getByTestId } = render(
      <SearchBar value="" onChangeText={() => {}} placeholder="Search" testID="bar" />
    );
    const input = getByTestId('bar');
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.autoCorrect).toBe(false);
    expect(input.props.returnKeyType).toBe('search');
    expect(input.props.keyboardAppearance).toBeDefined();
  });

  it('shows the clear button only when there is text, and clears it', () => {
    const onChangeText = jest.fn();
    const empty = render(<SearchBar value="" onChangeText={onChangeText} placeholder="Search" />);
    expect(empty.queryByLabelText('t:common.clearSearch')).toBeNull();
    empty.unmount();

    const filled = render(
      <SearchBar value="loop" onChangeText={onChangeText} placeholder="Search" />
    );
    fireEvent.press(filled.getByLabelText('t:common.clearSearch'));
    expect(onChangeText).toHaveBeenCalledWith('');
  });
});
