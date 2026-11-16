/**
 * Scenario: the athlete opens the import pane on the connect page, chooses an archive, and the
 * session sends it to the phone.
 *
 * Expected behaviour: choosing a file calls `importArchive` once with that file; each upload
 * phase draws its progress line (bytes sent against size, a resumed-link wording while waiting)
 * and the phone job's counts and failed names once it reports them; a refused write shows its
 * notice.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ImportPane } from '../../../web/connect/ImportPane';
import type { Upload } from '../../../web/connect/session';

const JOB = {
  state: 'done',
  stopped: null,
  detail: null,
  seen: 9,
  stored: 5,
  alreadyStored: 3,
  failed: 1,
  otherFormat: 0,
  skipped: 0,
  current: null,
  failures: [{ name: 'broken.fit', key: null, reason: 'unreadable' }],
} as unknown as NonNullable<Upload['job']>;

const upload = (patch: Partial<Upload>): Upload => ({
  name: 'rides.zip',
  size: 4_000_000,
  done: 1_000_000,
  phase: 'sending',
  job: null,
  error: null,
  ...patch,
});

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

async function mount(element: React.ReactElement) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(element);
  });
  return root;
}

const progress = (root: ReactTestRenderer) =>
  root.root.findAll((n) => n.props.id === 'import-progress' && typeof n.type === 'string')[0];

describe('the import pane', () => {
  it('calls importArchive once with the chosen file', async () => {
    const importArchive = jest.fn(async () => undefined);
    const root = await mount(
      <ImportPane upload={null} notice={null} importArchive={importArchive} />
    );
    const file = { name: 'rides.zip', size: 10 } as File;
    const input = root.root.findByType('input');
    expect(input.props.accept).toBe('.zip,.fit,.fit.gz');
    await act(async () => {
      input.props.onChange({ currentTarget: { files: [file], value: 'x' } });
    });
    expect(importArchive).toHaveBeenCalledTimes(1);
    expect(importArchive).toHaveBeenCalledWith(file);
  });

  it('calls nothing when the choice is empty', async () => {
    const importArchive = jest.fn(async () => undefined);
    const root = await mount(
      <ImportPane upload={null} notice={null} importArchive={importArchive} />
    );
    await act(async () => {
      root.root.findByType('input').props.onChange({ currentTarget: { files: [] } });
    });
    expect(importArchive).not.toHaveBeenCalled();
    expect(progress(root)).toBeUndefined();
  });

  it.each([
    ['hashing', 'connectPage.import.hashing'],
    ['sending', 'connectPage.import.sending'],
    ['waiting', 'connectPage.import.waiting'],
  ] as const)('draws bytes against size while %s', async (phase, key) => {
    const root = await mount(
      <ImportPane upload={upload({ phase })} notice={null} importArchive={jest.fn()} />
    );
    const line = progress(root);
    expect(line.props.value).toBe(1_000_000);
    expect(line.props.max).toBe(4_000_000);
    expect(textOf(root.root.findByProps({ id: 'import-status' }))).toBe(key);
  });

  it('draws the job counts and the failed names once the phone reports', async () => {
    const root = await mount(
      <ImportPane
        upload={upload({ phase: 'finished', done: 4_000_000, job: JOB })}
        notice={null}
        importArchive={jest.fn()}
      />
    );
    const counts = textOf(root.root.findByProps({ id: 'import-counts' }));
    expect(counts).toContain('5');
    expect(counts).toContain('3');
    expect(counts).toContain('1');
    expect(textOf(root.root.findByProps({ id: 'import-failures' }))).toContain('broken.fit');
  });

  it('shows the write notice and a failed upload', async () => {
    const root = await mount(
      <ImportPane
        upload={upload({ phase: 'failed', error: 'refused' })}
        notice={'connectPage.notice.phoneLocked' as never}
        importArchive={jest.fn()}
      />
    );
    expect(textOf(root.root.findByProps({ id: 'import-notice' }))).toBe(
      'connectPage.notice.phoneLocked'
    );
    expect(textOf(root.root.findByProps({ id: 'import-status' }))).toBe(
      'connectPage.import.failed'
    );
  });
});
