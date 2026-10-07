import React, { createRef } from 'react';
import { TextInput } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { HeroNameRow } from '@/shared/ui/DetailHero';

it('limits a pasted section name to the engine validation boundary', () => {
  render(
    <HeroNameRow
      name="Old climb"
      editable={{
        isEditing: true,
        editName: '',
        inputRef: createRef<TextInput>(),
        placeholder: 'Name',
        testIDPrefix: 'section',
        onStartEdit: jest.fn(),
        onSave: jest.fn(),
        onCancel: jest.fn(),
        onChange: jest.fn(),
      }}
    />
  );

  expect(screen.getByTestId('section-rename-input').props.maxLength).toBe(255);
});
