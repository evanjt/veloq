/**
 * Scenario: a fresh install signs in, syncs a library and loses the radio
 * without a map ever having been opened. The pre-seed runs off that sync, and
 * Rust can only fetch ground it has a template for.
 *
 * Expected behaviour: the two ground sources are handed over at launch, under
 * the keys the Rust pre-seed knows them by, and off a platform that can
 * intercept nothing is handed over at all.
 */

import { Platform } from 'react-native';

import { handOverGroundTemplates } from '@/features/maps/lib/tileTransport';
import { LIBERTY_SOURCES } from '@/features/maps/styles/liberty/sources';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides({}));

function setSourceTemplate(): jest.Mock {
  const { basemapStore } = require('veloqrs') as typeof import('veloqrs');
  return basemapStore().setSourceTemplate as unknown as jest.Mock;
}

function onPlatform(os: 'android' | 'ios' | 'web') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => setSourceTemplate().mockClear());
afterEach(() => onPlatform('android'));

describe('the ground templates a pre-seed needs', () => {
  it('hands over the vector source by its TileJSON url', () => {
    onPlatform('android');

    handOverGroundTemplates();

    expect(setSourceTemplate()).toHaveBeenCalledWith(
      'openmaptiles',
      LIBERTY_SOURCES.openmaptiles.url
    );
  });

  it('hands over the shaded-relief ground by its tile template', () => {
    onPlatform('ios');

    handOverGroundTemplates();

    expect(setSourceTemplate()).toHaveBeenCalledWith(
      'ne2_shaded',
      LIBERTY_SOURCES.ne2_shaded.tiles[0]
    );
  });

  it('hands over nothing where no tile URL can be answered', () => {
    onPlatform('web');

    handOverGroundTemplates();

    expect(setSourceTemplate()).not.toHaveBeenCalled();
  });

  it('names the two sources the style itself draws its ground from', () => {
    onPlatform('android');

    handOverGroundTemplates();

    const named = setSourceTemplate().mock.calls.map((call) => call[0]);
    expect(named.sort()).toEqual(Object.keys(LIBERTY_SOURCES).sort());
  });
});
