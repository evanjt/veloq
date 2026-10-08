import { offlineConfirmMessage } from '@/features/settings/lib/offlineConfirmCopy';

/**
 * Scenario: a destructive confirm (signing out, clearing and reloading the
 * library) is offered with copy written for a device that is online. Offline
 * the step that follows it cannot happen: signing back in and the reload both
 * need a network round trip, so the athlete is left signed out or with an
 * empty library until the radio comes back.
 * Expected behaviour: the alert says so while offline, and reads exactly as it
 * did before once the radio is up.
 */

const BASE = 'This removes the bird log.';
const WARNING = 'You are offline and the bird log stays empty until you have a connection.';

describe('the offline confirm copy', () => {
  it('says nothing extra while the radio is up', () => {
    expect(offlineConfirmMessage(BASE, WARNING, true)).toBe(BASE);
  });

  it('names what the action costs while the radio is down', () => {
    const message = offlineConfirmMessage(BASE, WARNING, false);

    expect(message).toContain(BASE);
    expect(message).toContain(WARNING);
  });

  it('puts the warning after the base copy, not in place of it', () => {
    const message = offlineConfirmMessage(BASE, WARNING, false);

    expect(message.indexOf(BASE)).toBeLessThan(message.indexOf(WARNING));
  });

  it('does not repeat a warning the base copy already carries', () => {
    const message = offlineConfirmMessage(`${BASE} ${WARNING}`, WARNING, false);

    expect(message.split(WARNING)).toHaveLength(2);
  });
});
