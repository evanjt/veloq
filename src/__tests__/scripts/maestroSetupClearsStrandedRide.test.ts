/**
 * Scenario: a recording flow dies on the review screen and leaves its stopped
 * ride there. A stopped ride that was never saved or discarded reopens on the
 * review screen at every launch, so the shared setup, which requires the home
 * screen, fails, and every later flow fails with it before its own cleanup
 * runs. On a short screen the discard button also sits below the fold.
 *
 * A ride with a track opens on a map hero over the top of the screen, and only
 * the form under it scrolls, so a scroll that swipes from the centre of the
 * screen pans the map and never reaches the button.
 *
 * Expected behaviour: the shared setup discards a stranded demo ride and
 * reaches home, on a tall screen and a short one, with a map hero or without. A real account's ride is
 * never touched, and setup still refuses that session.
 *
 * On iOS the alert's accept and the screen's own Discard button share a label.
 * Maestro there takes the first match in the hierarchy, where the screen comes
 * before the alert, and the alert's title anchors on the alert's whole frame,
 * so a tap "below the title" lands on the screen's button behind the alert and
 * the alert stays up.
 *
 * The real flow files run through a small interpreter of the Maestro commands
 * they use, against a model of the screens they meet. A command the model does
 * not know fails the suite, so a new step in the helpers has to be modelled
 * before it can pass.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const { loadAll } = require('js-yaml') as { loadAll: (source: string) => unknown[] };

const HELPERS = resolve(__dirname, '../../../.maestro/helpers');

type Screen = 'none' | 'login' | 'home' | 'review';

interface App {
  platform: 'Android' | 'iOS';
  screen: Screen;
  demo: boolean;
  signedIn: boolean;
  /** A stopped ride that reopens on the review screen at launch. */
  strandedRide: boolean;
  /** Whether the login demo button and the discard button fit above the fold without scrolling. */
  tall: boolean;
  /** Whether the review opens on a map hero, which keeps the button below the fold. */
  mapHero: boolean;
  scrolled: boolean;
  alert: boolean;
  discarded: number;
}

type Selector =
  | string
  | {
      id?: string;
      text?: string;
      below?: string;
      above?: Selector;
      optional?: boolean;
    };
type Command = string | Record<string, unknown>;

function ids(app: App): string[] {
  const banner = app.demo ? ['demo-mode-banner'] : [];
  switch (app.screen) {
    case 'login':
      return ['login-screen', ...(app.tall || app.scrolled ? ['login-demo-button'] : [])];
    case 'home':
      return ['home-screen', 'record-fab', ...banner];
    case 'review':
      return [
        'review-screen',
        'review-activity-name',
        'review-save-button',
        ...((app.tall && !app.mapHero) || app.scrolled ? ['review-discard-button'] : []),
        ...banner,
      ];
    default:
      return [];
  }
}

/** Ids on the screen, whether or not they are scrolled into view. */
function idsOnScreen(app: App): string[] {
  return app.screen === 'none' ? [] : ids({ ...app, scrolled: true });
}

function texts(app: App): string[] {
  const found: string[] = [];
  if (ids(app).includes('review-discard-button')) found.push('Discard');
  if (app.alert) found.push('Discard this recording?', 'Discard');
  return found;
}

function matchesText(pattern: string, text: string): boolean {
  return new RegExp(`^(?:${pattern})$`).test(text);
}

function visible(app: App, selector: Selector): boolean {
  if (typeof selector === 'string') return texts(app).some((t) => matchesText(selector, t));
  if (selector.id) return ids(app).includes(selector.id);
  if (selector.text) return texts(app).some((t) => matchesText(selector.text as string, t));
  throw new Error(`unmodelled selector ${JSON.stringify(selector)}`);
}

function launch(app: App) {
  app.alert = false;
  app.scrolled = false;
  if (app.strandedRide) app.screen = 'review';
  else app.screen = app.signedIn ? 'home' : 'login';
}

function tap(app: App, selector: Selector) {
  const optional = typeof selector === 'object' && selector.optional === true;
  if (!visible(app, selector)) {
    if (optional) return;
    throw new Error(`Element not found: ${JSON.stringify(selector)} on ${app.screen}`);
  }
  if (typeof selector === 'object' && selector.id === 'login-demo-button') {
    app.signedIn = true;
    app.demo = true;
    app.screen = 'home';
  } else if (typeof selector === 'object' && selector.id === 'review-discard-button') {
    app.alert = true;
  } else if (app.alert && typeof selector === 'object' && selector.text === 'Discard') {
    if (!acceptResolvesToAlert(app, selector)) return;
    app.alert = false;
    app.strandedRide = false;
    app.discarded += 1;
    app.screen = 'home';
  } else {
    throw new Error(`unmodelled tap ${JSON.stringify(selector)} on ${app.screen}`);
  }
}

/**
 * Whether a tap on the label Discard, with the alert up, resolves to the alert's
 * accept rather than to the screen's own button behind it.
 */
function acceptResolvesToAlert(app: App, selector: { below?: string; above?: Selector }): boolean {
  // The alert sits over the screen's button, so only the alert's accept is above it.
  if (typeof selector.above === 'object' && selector.above.id === 'review-discard-button') {
    return true;
  }
  if (selector.below !== undefined) return app.platform === 'Android';
  throw new Error(`unmodelled Discard tap ${JSON.stringify(selector)}`);
}

function conditionHolds(app: App, when: Record<string, unknown>): boolean {
  return Object.entries(when).every(([kind, value]) => {
    if (kind === 'platform') return value === app.platform;
    if (kind === 'visible') return visible(app, value as Selector);
    if (kind === 'notVisible') return !visible(app, value as Selector);
    if (kind === 'true') {
      const expression = String(value).replace(/^\$\{([\s\S]*)\}$/, '$1');
      return Boolean(new Function('NOTIFICATIONS_PERMISSION', `return ${expression}`)(undefined));
    }
    throw new Error(`unmodelled condition ${kind}`);
  });
}

function readFlow(file: string, env: Record<string, string> = {}): Command[] {
  const source = readFileSync(file, 'utf8').replace(/\$\{(\w+)\}/g, (whole, name: string) =>
    name in env ? env[name] : whole
  );
  const documents = loadAll(source);
  return documents[documents.length - 1] as Command[];
}

function run(app: App, file: string, commands: Command[] = readFlow(file)) {
  for (const command of commands) {
    const [name, args] =
      typeof command === 'string' ? [command, undefined] : Object.entries(command)[0];
    switch (name) {
      case 'launchApp':
        launch(app);
        break;
      case 'stopApp':
        app.screen = 'none';
        break;
      case 'runFlow': {
        const flow = args as {
          when?: Record<string, unknown>;
          file?: string;
          env?: Record<string, string>;
          commands?: Command[];
        };
        if (flow.when && !conditionHolds(app, flow.when)) break;
        if (flow.file) {
          const nested = join(dirname(file), flow.file);
          run(app, nested, readFlow(nested, flow.env));
        } else {
          run(app, file, flow.commands ?? []);
        }
        break;
      }
      case 'tapOn':
        tap(app, args as Selector);
        break;
      case 'extendedWaitUntil': {
        const wait = args as { visible?: Selector; notVisible?: Selector; optional?: boolean };
        const holds = wait.visible
          ? visible(app, wait.visible)
          : !visible(app, wait.notVisible as Selector);
        if (!holds && !wait.optional) {
          throw new Error(`Assertion is false: ${JSON.stringify(wait)} on ${app.screen}`);
        }
        break;
      }
      case 'scrollUntilVisible': {
        const scroll = args as { element: Selector; optional?: boolean };
        const target = scroll.element;
        const id = typeof target === 'string' ? undefined : target.id;
        // It swipes from the centre of the screen, which a map hero covers.
        const formMoves = app.screen !== 'review' || !app.mapHero;
        if (id && formMoves && idsOnScreen(app).includes(id)) app.scrolled = true;
        else if (!visible(app, target) && !scroll.optional) {
          throw new Error(`Element not found while scrolling: ${JSON.stringify(target)}`);
        }
        break;
      }
      case 'swipe': {
        const swipe = args as { start: string; end: string };
        const startY = Number(swipe.start.split(',')[1].trim().replace('%', ''));
        // The form is the lower part of the review, under the map hero.
        if (app.screen === 'review' && startY > 50) app.scrolled = true;
        break;
      }
      case 'repeat': {
        const loop = args as {
          while?: Record<string, unknown>;
          times?: number;
          commands: Command[];
        };
        for (let i = 0; i < (loop.times ?? Infinity); i += 1) {
          if (loop.while && !conditionHolds(app, loop.while)) break;
          run(app, file, loop.commands);
        }
        break;
      }
      case 'assertVisible':
        if (!visible(app, args as Selector)) {
          throw new Error(`Assertion is false: ${JSON.stringify(args)} is visible`);
        }
        break;
      case 'assertNotVisible':
        if (visible(app, args as Selector)) {
          throw new Error(`Assertion is false: ${JSON.stringify(args)} is not visible`);
        }
        break;
      default:
        throw new Error(`unmodelled Maestro command ${name} in ${file}`);
    }
  }
}

function makeApp(overrides: Partial<App>): App {
  return {
    platform: 'Android',
    screen: 'none',
    demo: true,
    signedIn: true,
    strandedRide: false,
    tall: true,
    mapHero: false,
    scrolled: false,
    alert: false,
    discarded: 0,
    ...overrides,
  };
}

const SETUP = join(HELPERS, 'setup-demo-mode.yaml');

describe('the shared demo setup', () => {
  it('reaches home with nothing to discard when no ride is stranded', () => {
    const app = makeApp({});
    run(app, SETUP);
    expect(app.screen).toBe('home');
    expect(app.discarded).toBe(0);
  });

  it('enters demo mode from the login screen', () => {
    const app = makeApp({ demo: false, signedIn: false });
    run(app, SETUP);
    expect(app.screen).toBe('home');
    expect(app.demo).toBe(true);
  });

  it.each(['Android', 'iOS'] as const)(
    'enters demo mode on %s when the largest text pushes the demo button below the fold',
    (platform) => {
      const app = makeApp({ platform, demo: false, signedIn: false, tall: false });
      run(app, SETUP);
      expect(app.screen).toBe('home');
      expect(app.demo).toBe(true);
    }
  );

  it('discards a stranded demo ride and reaches home on a tall screen', () => {
    const app = makeApp({ strandedRide: true });
    run(app, SETUP);
    expect(app.screen).toBe('home');
    expect(app.strandedRide).toBe(false);
    expect(app.discarded).toBe(1);
  });

  it('discards a stranded demo ride whose discard button is below the fold', () => {
    const app = makeApp({ strandedRide: true, tall: false });
    run(app, SETUP);
    expect(app.screen).toBe('home');
    expect(app.strandedRide).toBe(false);
  });

  it('runs again cleanly after it has cleared a ride', () => {
    const app = makeApp({ strandedRide: true, tall: false });
    run(app, SETUP);
    run(app, SETUP);
    expect(app.screen).toBe('home');
    expect(app.discarded).toBe(1);
  });

  it("never discards a real account's ride, and still refuses that session", () => {
    const app = makeApp({ demo: false, strandedRide: true });
    expect(() => run(app, SETUP)).toThrow();
    expect(app.strandedRide).toBe(true);
    expect(app.discarded).toBe(0);
  });
});

describe.each(['Android', 'iOS'] as const)('the review discard helper on %s', (platform) => {
  it('scrolls to a discard button below the fold before tapping it', () => {
    const app = makeApp({ platform, strandedRide: true, tall: false });
    launch(app);
    run(app, join(HELPERS, 'confirm-review-discard.yaml'));
    expect(app.strandedRide).toBe(false);
    expect(app.screen).toBe('home');
  });

  it('reaches a discard button under a map hero, which a centre swipe only pans', () => {
    const app = makeApp({ platform, strandedRide: true, mapHero: true });
    launch(app);
    run(app, join(HELPERS, 'confirm-review-discard.yaml'));
    expect(app.discarded).toBe(1);
    expect(app.screen).toBe('home');
  });

  it("takes the alert's accept and not the screen's own Discard behind it", () => {
    const app = makeApp({ platform, strandedRide: true });
    launch(app);
    run(app, join(HELPERS, 'confirm-review-discard.yaml'));
    expect(app.alert).toBe(false);
    expect(app.discarded).toBe(1);
  });
});

describe('the shared demo setup on iOS', () => {
  it('discards a stranded demo ride and reaches home', () => {
    const app = makeApp({ platform: 'iOS', strandedRide: true, tall: false });
    run(app, SETUP);
    expect(app.screen).toBe('home');
    expect(app.discarded).toBe(1);
  });
});
