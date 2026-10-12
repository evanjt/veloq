/**
 * Scenario: the athlete is drawing a section on an activity map, trimming a
 * section's bounds or renaming a section or route in its hero, and presses
 * back.
 *
 * Expected behaviour: back does what the mode's own Cancel does and the screen
 * stays. Back is left alone outside the mode, and a trim whose save is in
 * flight, where Cancel is disabled, is not ended by back either.
 */

import React from 'react';
import { Alert } from 'react-native';
import { act, render, renderHook } from '@testing-library/react-native';
import { useSectionCreation } from '@/features/maps/hooks/useSectionCreation';
import { useSectionTrim } from '@/features/routes/hooks/useSectionTrim';
import { HeroNameRow } from '@/shared/ui/DetailHero';
import type { TextFieldHandle } from '@/shared/ui/TextField';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';
import { stubHardwareBack, type HardwareBack } from '../__shared__/hardwareBack';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

let back: HardwareBack;

beforeEach(() => {
  back = stubHardwareBack();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  back.restore();
  jest.restoreAllMocks();
});

const track = [
  { latitude: -33.87, longitude: 151.2 },
  { latitude: -33.871, longitude: 151.201 },
  { latitude: -33.872, longitude: 151.202 },
];

describe('section creation', () => {
  async function renderCreation(creationMode: boolean) {
    const onCreationCancelled = jest.fn();
    const hook = await renderHook(() =>
      useSectionCreation({
        creationMode,
        externalCreationState: undefined,
        validCoordinates: track,
        onCreationCancelled,
      })
    );
    return { hook, onCreationCancelled };
  }

  it('cancels creation and drops the picks on back', async () => {
    const { hook, onCreationCancelled } = await renderCreation(true);
    await act(() => {
      hook.result.current.handleCreationTap(151.2, -33.87);
    });
    expect(hook.result.current.startIndex).toBe(0);

    await act(() => {
      expect(back.press()).toBe(true);
    });

    expect(onCreationCancelled).toHaveBeenCalledTimes(1);
    expect(hook.result.current.startIndex).toBeNull();
  });

  it('leaves back alone outside creation', async () => {
    const { onCreationCancelled } = await renderCreation(false);

    expect(back.press()).toBe(false);
    expect(onCreationCancelled).not.toHaveBeenCalled();
  });
});

describe('section trim', () => {
  const section = {
    id: 'ridge',
    polyline: Array.from({ length: 20 }, (_, i) => ({ lat: 46 + i * 0.0001, lng: 7 })),
    distanceMeters: 400,
  } as unknown as FrequentSection;

  function renderTrim() {
    return renderHook(() => useSectionTrim(section, jest.fn(), false));
  }

  it('ends trim mode on back, the way Cancel does', async () => {
    const hook = await renderTrim();
    expect(back.press()).toBe(false);

    await act(() => hook.result.current.startTrim());
    await act(() => {
      expect(back.press()).toBe(true);
    });

    expect(hook.result.current.isTrimming).toBe(false);
    expect(back.press()).toBe(false);
  });

  it('holds trim mode on back while the save is in flight', async () => {
    let finish: (departed: unknown[]) => void = () => {};
    (getEngine as jest.Mock).mockReturnValue({
      runSectionBoundsEdit: jest.fn(() => new Promise((resolve) => (finish = resolve))),
    });
    const hook = await renderTrim();
    await act(() => hook.result.current.startTrim());
    await act(() => hook.result.current.setTrimEnd(10));
    await act(() => {
      void hook.result.current.confirmTrim();
    });
    expect(hook.result.current.isSaving).toBe(true);

    await act(() => {
      expect(back.press()).toBe(true);
    });
    expect(hook.result.current.isTrimming).toBe(true);

    await act(async () => {
      finish([]);
    });
    expect(hook.result.current.isTrimming).toBe(false);
  });
});

describe('hero rename', () => {
  async function renderName(isEditing: boolean) {
    const onCancel = jest.fn();
    const inputRef = React.createRef<TextFieldHandle>();
    await render(
      <HeroNameRow
        name="Ridge climb"
        editable={{
          isEditing,
          editName: 'Ridge cl',
          inputRef,
          label: 'Name',
          testIDPrefix: 'section',
          onStartEdit: jest.fn(),
          onSave: jest.fn(),
          onCancel,
          onChange: jest.fn(),
        }}
      />
    );
    return onCancel;
  }

  it('cancels the rename on back', async () => {
    const onCancel = await renderName(true);

    expect(back.press()).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('leaves back alone while the name is not being edited', async () => {
    const onCancel = await renderName(false);

    expect(back.press()).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
