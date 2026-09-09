/**
 * Scenario: an activity a section is cut from cannot be deleted.
 * Expected behaviour: the delegate returns the engine's refusal reason
 * instead of a bare false, so the caller can name the sections.
 */
import { removeActivity } from '@/../modules/veloqrs/src/delegates/activities';

type Host = Parameters<typeof removeActivity>[0];

function host(remove: (id: string) => void, ready = true): Host {
  return {
    ready,
    timed: <T>(_label: string, fn: () => T) => fn(),
    notifyAll: jest.fn(),
    engine: { activities: () => ({ remove }) },
  } as unknown as Host;
}

describe('removeActivity', () => {
  it('reports success and notifies once the engine accepts the delete', () => {
    const h = host(() => undefined);
    expect(removeActivity(h, 'plain')).toEqual({ ok: true });
    expect(h.notifyAll).toHaveBeenCalledWith('activities', 'groups', 'sections');
  });

  it('carries the refusal reason back and does not notify', () => {
    const h = host(() => {
      throw new Error('Reference activity: auto_1,auto_2');
    });
    expect(removeActivity(h, 'rep')).toEqual({
      ok: false,
      reason: 'Reference activity: auto_1,auto_2',
    });
    expect(h.notifyAll).not.toHaveBeenCalled();
  });

  it('refuses before the engine is ready', () => {
    const remove = jest.fn();
    expect(removeActivity(host(remove, false), 'plain')).toEqual({
      ok: false,
      reason: 'engine not ready',
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
