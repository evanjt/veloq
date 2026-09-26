import { signOutMessage } from '@/features/settings/lib/signOutCopy';

/**
 * Scenario: signing out is offered with copy that says the credentials can be
 * entered again. Offline they cannot: both login paths make a network round
 * trip before anything is accepted, so the athlete is locked out of their own
 * cached data until the radio comes back.
 * Expected behaviour: the alert says so while offline, and reads exactly as it
 * did before once the radio is up.
 */

const BASE = 'This removes your credentials.';
const WARNING = 'You are offline and cannot sign back in until you have a connection.';

describe('the sign-out alert copy', () => {
  it('says nothing extra while the radio is up', () => {
    expect(signOutMessage(BASE, WARNING, true)).toBe(BASE);
  });

  it('names what signing out costs while the radio is down', () => {
    const message = signOutMessage(BASE, WARNING, false);

    expect(message).toContain(BASE);
    expect(message).toContain(WARNING);
  });

  it('puts the warning after the base copy, not in place of it', () => {
    const message = signOutMessage(BASE, WARNING, false);

    expect(message.indexOf(BASE)).toBeLessThan(message.indexOf(WARNING));
  });

  it('does not repeat a warning the base copy already carries', () => {
    const message = signOutMessage(`${BASE} ${WARNING}`, WARNING, false);

    expect(message.split(WARNING)).toHaveLength(2);
  });
});
