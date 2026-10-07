/**
 * Scenario: the handset is signed into a real intervals.icu account, with debug
 * mode on and a recording prompt on screen, and the gate or a pack runs
 * against it. The shared demo setup refuses a real session, but a flow that
 * skips that setup, or an `onFlowComplete` hook, which runs after a refusal
 * too, still acts on whatever session the app holds: one signed the real
 * account out, one reset its support card and switched its debug mode off, and
 * nine tapped Discard on whatever recording prompt was showing.
 *
 * Expected behaviour: against a real session these flows tap nothing and type
 * nothing, and against a demo session they still do their own cleanup.
 *
 * The flows run through a dry-run of the Maestro commands they use, against a
 * model of the app that answers what is visible. The model of a real session
 * is pessimistic: every element is there except the demo banner, the login
 * screen and the system dialogs, so a step that would act on the session gets
 * the chance to.
 */
import * as fs from 'fs';
import * as path from 'path';

const yaml = require('js-yaml') as { load: (source: string) => unknown };

const FLOWS = path.resolve(__dirname, '../../../.maestro');

type Selector = { id?: string; text?: string };
type Step = Selector & { optional?: boolean | undefined };
type Command = string | Record<string, unknown>;

interface Session {
  visible(selector: Selector): boolean;
  tap(selector: Selector): void;
  launch(): void;
}

interface Trace {
  taps: string[];
  inputs: string[];
}

class FlowFailed extends Error {}

const DIALOGS = ['Open', 'Not Now', 'Done', 'Skip', 'Close'];

/** A real account, in front, with debug mode on and a recording prompt showing. */
function realSession(): Session {
  let signedOut = false;
  return {
    visible: ({ id, text }) => {
      if (id === 'demo-mode-banner') return false;
      if (id === 'login-screen') return signedOut;
      if (id === 'home-screen') return !signedOut;
      if (text && DIALOGS.includes(text)) return false;
      return true;
    },
    tap: ({ text }) => {
      if (text === 'Disconnect') signedOut = true;
    },
    launch: () => {},
  };
}

/**
 * A demo session. It does not survive a relaunch, so `launchApp` lands on the
 * login screen until the demo button is tapped again.
 */
function demoSession(entered = false): Session {
  let demo = entered;
  return {
    visible: ({ id, text }) => {
      if (id === 'demo-mode-banner' || id === 'home-screen') return demo;
      if (id === 'login-screen') return !demo;
      if (text && DIALOGS.includes(text)) return false;
      return true;
    },
    tap: ({ id }) => {
      if (id === 'login-demo-button') demo = true;
    },
    launch: () => {
      demo = false;
    },
  };
}

function selector(value: unknown): Step {
  if (typeof value === 'string') return { text: value };
  return value as Step;
}

const label = ({ id, text }: Selector) => id ?? text ?? '?';

function parse(file: string): { header: Record<string, unknown>; body: Command[] } {
  const source = fs.readFileSync(file, 'utf8');
  const split = source.indexOf('\n---\n');
  const header = (yaml.load(source.slice(0, split)) ?? {}) as Record<string, unknown>;
  const body = (yaml.load(source.slice(split + 5)) ?? []) as Command[];
  return { header, body };
}

class DryRun {
  readonly trace: Trace = { taps: [], inputs: [] };

  constructor(
    private readonly session: Session,
    private readonly dir: string
  ) {}

  private holds(condition: Record<string, unknown>): boolean {
    if ('platform' in condition && condition.platform !== 'Android') return false;
    if ('visible' in condition && !this.session.visible(selector(condition.visible))) return false;
    if ('notVisible' in condition && this.session.visible(selector(condition.notVisible))) {
      return false;
    }
    return true;
  }

  private expect(seen: boolean, step: Step, what: string) {
    if (!seen && !step.optional) throw new FlowFailed(`${what} ${label(step)}`);
  }

  run(commands: Command[]): void {
    for (const command of commands) this.step(command);
  }

  private step(command: Command): void {
    const [name, arg] =
      typeof command === 'string' ? [command, undefined] : Object.entries(command)[0];
    switch (name) {
      case 'launchApp':
        this.session.launch();
        return;
      case 'tapOn': {
        const target = selector(arg);
        if (this.session.visible(target)) {
          this.trace.taps.push(label(target));
          this.session.tap(target);
        } else {
          this.expect(false, target, 'tapOn');
        }
        return;
      }
      case 'inputText':
        this.trace.inputs.push(String(arg));
        return;
      case 'assertVisible': {
        const target = selector(arg);
        this.expect(this.session.visible(target), target, 'assertVisible');
        return;
      }
      case 'assertNotVisible': {
        const target = selector(arg);
        this.expect(!this.session.visible(target), target, 'assertNotVisible');
        return;
      }
      case 'extendedWaitUntil': {
        const wait = arg as { visible?: unknown; notVisible?: unknown; optional?: boolean };
        const target = selector(wait.visible ?? wait.notVisible);
        const seen = this.session.visible(target);
        this.expect(wait.visible ? seen : !seen, { ...target, optional: wait.optional }, 'wait');
        return;
      }
      case 'scrollUntilVisible': {
        const scroll = arg as { element: unknown; optional?: boolean };
        const target = selector(scroll.element);
        this.expect(
          this.session.visible(target),
          { ...target, optional: scroll.optional },
          'scroll'
        );
        return;
      }
      case 'runFlow': {
        const nested = arg as {
          file?: string;
          when?: Record<string, unknown>;
          commands?: Command[];
        };
        if (nested.when && !this.holds(nested.when)) return;
        if (nested.file) this.run(parse(path.join(this.dir, nested.file)).body);
        if (nested.commands) this.run(nested.commands);
        return;
      }
      case 'repeat': {
        const repeat = arg as { times?: number; commands: Command[] };
        for (let i = 0; i < (repeat.times ?? 1); i += 1) this.run(repeat.commands);
        return;
      }
      case 'openLink':
      case 'stopApp':
      case 'back':
      case 'scroll':
      case 'swipe':
      case 'hideKeyboard':
      case 'eraseText':
      case 'pressKey':
      case 'waitForAnimationToEnd':
      case 'takeScreenshot':
        return;
      default:
        throw new Error(`the dry-run does not model ${name}`);
    }
  }
}

/** The flow's body, then its `onFlowComplete` whether or not the body failed. */
function runFlow(flow: string, session: Session) {
  const file = path.join(FLOWS, flow);
  const { header, body } = parse(file);
  const dry = new DryRun(session, path.dirname(file));
  let failed: string | null = null;
  try {
    dry.run(body);
  } catch (e) {
    if (!(e instanceof FlowFailed)) throw e;
    failed = e.message;
  }
  try {
    dry.run((header.onFlowComplete as Command[] | undefined) ?? []);
  } catch (e) {
    if (!(e instanceof FlowFailed)) throw e;
  }
  return { failed, ...dry.trace };
}

/** The `onFlowComplete` hook alone, as it runs after a body that stopped anywhere. */
function runHook(flow: string, session: Session) {
  const file = path.join(FLOWS, flow);
  const dry = new DryRun(session, path.dirname(file));
  try {
    dry.run((parse(file).header.onFlowComplete as Command[] | undefined) ?? []);
  } catch (e) {
    if (!(e instanceof FlowFailed)) throw e;
  }
  return dry.trace;
}

const RECORDING_FLOWS = fs
  .readdirSync(FLOWS)
  .filter((f) => f.startsWith('recording-') && f.endsWith('.yaml'))
  .filter((f) => parse(path.join(FLOWS, f)).header.onFlowComplete)
  .sort();

describe('a real session', () => {
  it('has the recording flows with a cleanup hook to check', () => {
    expect(RECORDING_FLOWS.length).toBeGreaterThan(0);
  });

  it.each(['auth-api-key-validation.yaml', 'settings-support-iap.yaml', ...RECORDING_FLOWS])(
    '%s taps nothing and types nothing',
    (flow) => {
      const result = runFlow(flow, realSession());

      expect(result.failed).not.toBeNull();
      expect(result.taps).toEqual([]);
      expect(result.inputs).toEqual([]);
    }
  );
});

describe('a demo session', () => {
  it('auth-api-key-validation still checks the key and re-enters demo mode', () => {
    const result = runFlow('auth-api-key-validation.yaml', demoSession(true));

    expect(result.failed).toBeNull();
    expect(result.inputs).toEqual(['invalid-test-key']);
    expect(result.taps).toContain('login-apikey-button');
    expect(result.taps[result.taps.length - 1]).toBe('login-demo-button');
  });

  it('settings-support-iap still resets the support card and the debug switch', () => {
    const taps = runHook('settings-support-iap.yaml', demoSession(true)).taps;

    expect(taps).toContain('debug-support-preset-0d');
    expect(taps).toContain('settings-debug-switch');
  });

  it.each(RECORDING_FLOWS)('%s still discards its own leftover recording', (flow) => {
    expect(runHook(flow, demoSession(true)).taps).toEqual(['(?i)discard']);
  });
});
