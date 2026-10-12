import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionHeader } from '@/features/routes/components/section/SectionHeader';
import { createMapHighlightStore } from '@/features/routes/lib/mapHighlight';
import type { FrequentSection } from '@/types';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

/**
 * Scenario: the detector flags a section whose ground is mostly a lift, the
 * flag survives every layer down to `isLift` on the FFI record, and no screen
 * draws it, so a section that looks wrong has nothing saying why.
 * Expected behaviour: a flagged section carries a badge in the detail header,
 * an unflagged one carries nothing, and the badge takes nothing away from the
 * name or its rename affordance.
 */

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: () => null,
}));

// The barrel pulls react-native-iap in through useDonation, so it is replaced
// rather than spread: the header only needs the unit preference from it.
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
}));

const BASE: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

async function renderHeader(section: FrequentSection, onUnflagLift?: () => void) {
  return await render(
    <SectionHeader
      section={section}
      onUnflagLift={onUnflagLift}
      insetTop={0}
      activityColor="#000000"
      iconName="bike"
      activityCount={3}
      mapReady={true}
      isTrimming={false}
      isExpandMode={false}
      trimStart={0}
      trimEnd={1}
      customName={null}
      highlight={createMapHighlightStore()}
      onSaveName={jest.fn()}
    />
  );
}

describe('section lift badge', () => {
  it('badges a section the detector flagged as lift ground', async () => {
    const tree = await renderHeader({ ...BASE, isLift: true });

    expect(tree.getByTestId('section-lift-badge')).toBeTruthy();
  });

  it('shows nothing on a section that is not lift ground', async () => {
    expect(
      await (await renderHeader({ ...BASE, isLift: false })).queryByTestId('section-lift-badge')
    ).toBeNull();
  });

  it('shows nothing when the flag never arrived', async () => {
    expect(await (await renderHeader(BASE)).queryByTestId('section-lift-badge')).toBeNull();
  });

  it('leaves the name and its rename affordance alone', async () => {
    const tree = await renderHeader({ ...BASE, name: 'Top Station', isLift: true });

    expect(tree.getByText('Top Station')).toBeTruthy();
    expect(tree.getByTestId('section-rename-button')).toBeTruthy();
    expect(tree.getByTestId('section-lift-badge')).toBeTruthy();
  });

  it('takes the flag off when the badge is pressed', async () => {
    const onUnflagLift = jest.fn();
    const tree = await renderHeader({ ...BASE, isLift: true }, onUnflagLift);

    await fireEvent.press(tree.getByTestId('section-lift-badge'));

    expect(onUnflagLift).toHaveBeenCalledTimes(1);
  });

  it('still draws the badge when nothing can take the flag off', async () => {
    const tree = await renderHeader({ ...BASE, isLift: true });

    expect(tree.getByTestId('section-lift-badge')).toBeTruthy();
    expect(tree.queryByTestId('section-lift-unflag')).toBeNull();
  });

  it('offers the unflag affordance only alongside a handler', async () => {
    const tree = await renderHeader({ ...BASE, isLift: true }, jest.fn());

    expect(tree.getByTestId('section-lift-unflag')).toBeTruthy();
  });
});

describe('section traversal count scope', () => {
  async function renderScoped(extra: Partial<React.ComponentProps<typeof SectionHeader>>) {
    return await render(
      <SectionHeader
        section={BASE}
        insetTop={0}
        activityColor="#000000"
        iconName="bike"
        activityCount={22}
        mapReady={true}
        isTrimming={false}
        isExpandMode={false}
        trimStart={0}
        trimEnd={1}
        customName={null}
        highlight={createMapHighlightStore()}
        onSaveName={jest.fn()}
        {...extra}
      />
    );
  }

  it('names the sport and the range when the section spans sports and the range is not all time', async () => {
    const tree = await renderScoped({ scopeSport: 'Run', sportsOffered: 2, scopeRange: '6m' });

    expect(
      tree.getByText('sections.traversalsCount · activityTypes.Run · period.long.6m')
    ).toBeTruthy();
  });

  it('names only the range for a single-sport section', async () => {
    const tree = await renderScoped({ scopeSport: 'Ride', sportsOffered: 1, scopeRange: '1y' });

    expect(tree.getByText('sections.traversalsCount · period.long.1y')).toBeTruthy();
  });

  it('adds nothing for a single-sport section over all time', async () => {
    const tree = await renderScoped({ scopeSport: 'Ride', sportsOffered: 1, scopeRange: 'all' });

    expect(tree.getByText('sections.traversalsCount')).toBeTruthy();
  });
});
