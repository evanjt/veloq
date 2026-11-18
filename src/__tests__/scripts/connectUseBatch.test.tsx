/**
 * Scenario: a group of writes is sent as one edit and the phone refuses one part way, as it does
 * when it locks while a long batch is out.
 *
 * Expected behaviour: the writes before the refusal stay in place and the one toast offers an
 * undo that takes back those writes only, with the refusal as its message; a batch refused on its
 * first write makes no toast; a batch with no refusal makes the toast it always did; the
 * function form of an undo is given the accepted answers only, and a fixed list is cut to the
 * accepted writes.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ToastProvider } from '../../../web/connect/ui';
import { useBatch, type Batch, type Undo, type Write } from '../../../web/connect/useBatch';
import { fakePhone } from '../__shared__/connectPhone';

const FAILED = 'failed';

/** Accepts every write but the one at `refuseAt` (counting writes, from zero), which is refused. */
function session(refuseAt: number | null) {
  let seen = 0;
  const phone = fakePhone((method, params) => {
    const at = seen;
    seen += 1;
    if (at === refuseAt) throw new Error('phone locked');
    return { ok: true, echoed: method, id: (params as { id?: string }).id };
  });
  return phone;
}

const ids = ['a', 'b', 'c', 'd'];
const writes: Write[] = ids.map(
  (id) => ({ method: 'route.excludeActivity', params: { id } }) as Write
);
const inverses: Write[] = ids.map(
  (id) => ({ method: 'route.includeActivity', params: { id } }) as Write
);

async function settle() {
  for (let at = 0; at < 6; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function run(refuseAt: number | null, undo: Undo) {
  const phone = session(refuseAt);
  let batch!: Batch;
  function Probe() {
    batch = useBatch(phone.queries, FAILED);
    return null;
  }
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      <ToastProvider dismissLabel="dismiss">
        <Probe />
      </ToastProvider>
    );
  });
  let outcome: boolean | undefined;
  await act(async () => {
    outcome = await batch.run(writes, 'done', undo, 'undo');
  });
  await settle();
  const toasts = root.root.findAll(
    (node) => node.type === 'div' && node.props.className === 'ui-toast'
  );
  const undoButton = root.root.findAll(
    (node) => node.type === 'button' && node.findAll((n) => n.children.includes('undo')).length > 0
  )[0];
  const message = toasts[0]?.findAll((n) => n.type === 'span')[0]?.children.join('');
  return { phone, root, outcome, toasts, undoButton, message, batch: () => batch };
}

const pressed = async (button: { props: { onClick: () => void } }) => {
  await act(async () => {
    button.props.onClick();
  });
  await settle();
};

const sentSince = (phone: ReturnType<typeof session>, from: number) =>
  phone.calls.slice(from).map((call) => [call.method, (call.params as { id: string }).id]);

describe('a batch refused part way', () => {
  it('offers one undo of the writes already accepted, with the refusal as the toast message', async () => {
    const result = await run(2, inverses);
    expect(result.outcome).toBe(false);
    expect(result.toasts).toHaveLength(1);
    expect(result.message).toBe('connectPage.notice.phoneLocked');
    expect(result.batch().refusal).toBe('connectPage.notice.phoneLocked');
    const before = result.phone.calls.length;
    await pressed(result.undoButton as never);
    expect(sentSince(result.phone, before)).toEqual([
      ['route.includeActivity', 'a'],
      ['route.includeActivity', 'b'],
    ]);
    result.root.unmount();
  });

  it('gives a function undo the accepted answers only', async () => {
    const seen: unknown[][] = [];
    const result = await run(1, (answers) => {
      seen.push([...answers]);
      return answers.map((answer) => ({
        method: 'route.includeActivity',
        params: { id: (answer as { id: string }).id },
      })) as Write[];
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    const before = result.phone.calls.length;
    await pressed(result.undoButton as never);
    expect(sentSince(result.phone, before)).toEqual([['route.includeActivity', 'a']]);
    result.root.unmount();
  });

  it('offers no undo and no toast when the first write is refused', async () => {
    const result = await run(0, inverses);
    expect(result.outcome).toBe(false);
    expect(result.toasts).toHaveLength(0);
    expect(result.batch().refusal).toBe('connectPage.notice.phoneLocked');
    expect(result.phone.calls).toHaveLength(1);
    result.root.unmount();
  });

  it('shows the plain toast and the whole undo when nothing is refused', async () => {
    const result = await run(null, inverses);
    expect(result.outcome).toBe(true);
    expect(result.message).toBe('done');
    expect(result.batch().refusal).toBeNull();
    const before = result.phone.calls.length;
    await pressed(result.undoButton as never);
    expect(sentSince(result.phone, before).map(([, id]) => id)).toEqual(ids);
    result.root.unmount();
  });
});
