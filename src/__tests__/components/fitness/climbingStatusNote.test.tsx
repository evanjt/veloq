/**
 * Scenario: the climb read ranks only corrected tracks, so a library whose rows are still owed or
 * whose rides carry device altitude has empty windows.
 *
 * Expected behaviour: the note names the excluded count and the still-computing state, and draws
 * nothing when both counts are zero.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { ClimbingStatusNote } from '@/features/fitness/components/ClimbingStatusNote';

describe('ClimbingStatusNote', () => {
  it('draws the excluded count', () => {
    render(<ClimbingStatusNote status={{ owed: 0, sourceExcluded: 2 }} />);
    expect(screen.getByTestId('climbing-source-excluded')).toBeTruthy();
    expect(screen.queryByTestId('climbing-owed')).toBeNull();
  });

  it('draws the still-computing line when rows are owed', () => {
    render(<ClimbingStatusNote status={{ owed: 3, sourceExcluded: 0 }} />);
    expect(screen.getByTestId('climbing-owed')).toBeTruthy();
    expect(screen.queryByTestId('climbing-source-excluded')).toBeNull();
  });

  it('draws both lines when both counts are above zero', () => {
    render(<ClimbingStatusNote status={{ owed: 1, sourceExcluded: 1 }} />);
    expect(screen.getByTestId('climbing-owed')).toBeTruthy();
    expect(screen.getByTestId('climbing-source-excluded')).toBeTruthy();
  });

  it('draws nothing when both are zero', () => {
    render(<ClimbingStatusNote status={{ owed: 0, sourceExcluded: 0 }} />);
    expect(screen.queryByTestId('climbing-owed')).toBeNull();
    expect(screen.queryByTestId('climbing-source-excluded')).toBeNull();
  });
});
