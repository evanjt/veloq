/**
 * Scenario: two panels of one page read the same method with the same
 * arguments, then the athlete leaves the page while the read is out.
 *
 * Expected behaviour: both panels draw the one answer from one request; a
 * panel on a method the phone does not list draws the typed notice and sends
 * nothing; leaving the page cancels the read; a write through `useWrite` reads
 * the reads it names again.
 */

import { useEffect } from 'react';
import { act, create } from 'react-test-renderer';

import { QueryClient, type Transport } from '../../../web/connect/query';
import { QueryProvider, useRead, useWrite, type Write } from '../../../web/connect/useRead';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Sent = {
  method: string;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
};

function phone(methods: string[]) {
  const sent: Sent[] = [];
  const transport: Transport = {
    methods: () => methods,
    ask: (method, _params, options) =>
      new Promise((resolve) => sent.push({ method, signal: options.signal, resolve })),
  };
  return { sent, client: new QueryClient(transport) };
}

function Panel({ name, method }: { name: string; method: 'feed.summary' | 'strength.screen' }) {
  const read = useRead(method, {} as never);
  if (read.error) return <p>{`${name}:${read.error.kind}`}</p>;
  if (read.loading) return <p>{`${name}:loading`}</p>;
  return <p>{`${name}:${String(read.data)}`}</p>;
}

const texts = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType('p').map((node) => node.children.join(''));

describe('useRead', () => {
  it('shares one request between two panels and draws the answer in both', async () => {
    const { sent, client } = phone(['feed.summary']);
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QueryProvider client={client}>
          <Panel name="a" method="feed.summary" />
          <Panel name="b" method="feed.summary" />
        </QueryProvider>
      );
    });
    expect(sent).toHaveLength(1);
    expect(texts(tree)).toEqual(['a:loading', 'b:loading']);
    await act(async () => sent[0].resolve('week'));
    expect(texts(tree)).toEqual(['a:week', 'b:week']);
  });

  it('draws the unsupported notice and sends nothing for a method the phone lacks', async () => {
    const { sent, client } = phone(['feed.summary']);
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QueryProvider client={client}>
          <Panel name="a" method="strength.screen" />
        </QueryProvider>
      );
    });
    expect(texts(tree)).toEqual(['a:unsupported']);
    expect(sent).toHaveLength(0);
  });

  it('cancels the read when the page unmounts', async () => {
    const { sent, client } = phone(['feed.summary']);
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QueryProvider client={client}>
          <Panel name="a" method="feed.summary" />
        </QueryProvider>
      );
    });
    expect(sent[0].signal.aborted).toBe(false);
    await act(async () => tree.unmount());
    expect(sent[0].signal.aborted).toBe(true);
  });
});

describe('useWrite', () => {
  it('reads again the reads the write names', async () => {
    const { sent, client } = phone(['feed.summary', 'strength.save']);
    const captured: { write: Write | null } = { write: null };
    function Probe() {
      const write = useWrite();
      useEffect(() => {
        captured.write = write;
      });
      return null;
    }
    await act(async () => {
      create(
        <QueryProvider client={client}>
          <Panel name="a" method="feed.summary" />
          <Probe />
        </QueryProvider>
      );
    });
    await act(async () => sent[0].resolve('week'));
    let done!: Promise<unknown>;
    await act(async () => {
      done = (captured.write as Write).run('strength.save' as never, {} as never, {
        invalidates: ['feed.summary'],
      });
    });
    await act(async () => sent[1].resolve({}));
    await done;
    expect(sent.map((ask) => ask.method)).toEqual([
      'feed.summary',
      'strength.save',
      'feed.summary',
    ]);
  });
});
