/**
 * A stand-in for the native stack header, for a render test with no navigator above it.
 *
 * The platform draws the header from the options a layout or a screen hands the stack, so a
 * render test never sees it. This draws the parts a suite asserts on: the title as a heading,
 * which is how both platforms present a header title, the trailing items, and the
 * navigation-bar search field as a text input that reports through the same event shape.
 *
 *   jest.mock('expo-router', () => ({
 *     ...jest.requireActual('expo-router'),
 *     Stack: require('../__shared__/nativeHeaderStandIn').Stack,
 *   }));
 */

import React, { useImperativeHandle, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

interface StandInOptions {
  title?: string;
  headerRight?: (props: { tintColor?: string; canGoBack: boolean }) => React.ReactNode;
  headerSearchBarOptions?: SearchOptions;
}

interface SearchOptions {
  ref?: React.RefObject<SearchBarCommands | null>;
  placeholder?: string;
  placement?: string;
  onChangeText?: (event: { nativeEvent: { text: string } }) => void;
}

/**
 * The field keeps its own text, as the native one does, so a screen that clears its query has to
 * clear the field through the ref. Setting the text through the ref calls nothing back.
 */
function SearchField({ search }: { search: SearchOptions }) {
  const [text, setText] = useState('');
  useImperativeHandle(search.ref, () => ({
    focus: () => {},
    blur: () => {},
    clearText: () => setText(''),
    toggleCancelButton: () => {},
    setText,
    cancelSearch: () => setText(''),
  }));
  return (
    <TextInput
      testID="native-header-search"
      placeholder={search.placeholder}
      accessibilityHint={search.placement}
      value={text}
      onChangeText={(next) => {
        setText(next);
        search.onChangeText?.({ nativeEvent: { text: next } });
      }}
    />
  );
}

function Header({ options }: { name?: string; options?: StandInOptions }) {
  const resolved = options ?? {};
  const search = resolved.headerSearchBarOptions;
  return (
    <View testID="native-header">
      {resolved.title ? <Text accessibilityRole="header">{resolved.title}</Text> : null}
      {search ? <SearchField search={search} /> : null}
      {resolved.headerRight ? (
        <View testID="native-header-right">{resolved.headerRight({ canGoBack: false })}</View>
      ) : null}
    </View>
  );
}

export function Stack({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
Stack.Screen = Header;
