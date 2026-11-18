/**
 * Scenario: the link's API reference page is rendered from `schema.json`, whose method rows
 * carry the doc string the engine's method table holds.
 * Expected behaviour: one section per method with its parameter and reply fields, its write flag
 * and its doc string; a method without a doc string stops the build; the committed page is the
 * render of the committed schema; and it names each farewell reason the engine declares.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { engineFarewellReasons } from '../__shared__/farewellReasons';

const REPO = join(__dirname, '../../..');
const LIB = join(REPO, 'scripts/lib/apiReference.mjs');

/** The module is ESM, which Jest does not load, so it runs in its own process. */
function renderApiReference(document: unknown): string {
  const program = `import { renderApiReference } from ${JSON.stringify(LIB)};
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    process.stdout.write(renderApiReference(JSON.parse(text)));`;
  try {
    return execFileSync('node', ['--input-type=module', '-e', program], {
      input: JSON.stringify(document),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error((error as { stderr?: string }).stderr ?? String(error));
  }
}

const schema = {
  protocol: 3,
  minProtocol: 2,
  methods: [
    {
      name: 'kettle.status',
      write: false,
      description: 'Reads the kettle’s water level.',
      params: { $ref: '#/$defs/KettleAsk' },
      result: { $ref: '#/$defs/KettleLevel' },
    },
    {
      name: 'kettle.boil',
      write: true,
      description: 'Starts a boil.',
      params: { $ref: '#/$defs/KettleBoilAsk' },
      result: { $ref: '#/$defs/KettleLevel' },
    },
  ],
  $defs: {
    KettleAsk: { type: 'object', properties: {}, required: [] },
    KettleBoilAsk: {
      type: 'object',
      properties: {
        targetTemp: { type: 'number', description: 'Degrees to reach.' },
        lid: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['targetTemp', 'lid'],
    },
    KettleLevel: {
      type: 'object',
      properties: { litres: { type: 'number' }, mode: { $ref: '#/$defs/KettleMode' } },
      required: ['litres', 'mode'],
      description: 'How full the kettle is.',
    },
    KettleMode: { type: 'string', enum: ['idle', 'boiling'] },
  },
};

it('renders one section per method with its fields, flag and doc string', () => {
  const html = renderApiReference(schema);
  expect(html).toContain('id="kettle.status"');
  expect(html).toContain('id="kettle.boil"');
  expect(html).toContain('Reads the kettle’s water level.');
  expect(html).toContain('targetTemp');
  expect(html).toContain('Degrees to reach.');
  expect(html).toContain('litres');
  expect(html).toContain('idle');
  expect(html.match(/class="method-write"/g)).toHaveLength(1);
});

it('stops when a method has no doc string', () => {
  const bare = {
    ...schema,
    methods: [{ ...schema.methods[0], description: undefined }, schema.methods[1]],
  };
  expect(() => renderApiReference(bare)).toThrow(/kettle\.status/);
  const blank = { ...schema, methods: [{ ...schema.methods[0], description: '  ' }] };
  expect(() => renderApiReference(blank)).toThrow(/kettle\.status/);
});

it('escapes markup in a doc string', () => {
  const html = renderApiReference({
    ...schema,
    methods: [{ ...schema.methods[0], description: 'Takes <b>bold</b> & more.' }],
  });
  expect(html).toContain('Takes &lt;b&gt;bold&lt;/b&gt; &amp; more.');
});

it('documents every method of the committed schema, and the page on disk is its render', () => {
  const real = JSON.parse(readFileSync(join(REPO, 'web/connect/schema.json'), 'utf8'));
  const methods = JSON.parse(readFileSync(join(REPO, 'web/connect/methods.json'), 'utf8'));
  expect(real.methods.map((m: { name: string }) => m.name)).toEqual(
    methods.methods.map((m: { name: string }) => m.name)
  );
  const html = renderApiReference(real);
  for (const method of real.methods) expect(html).toContain(`id="${method.name}"`);
  expect(readFileSync(join(REPO, 'docs/api/index.html'), 'utf8')).toBe(html);
});

it('names every farewell reason the engine declares', () => {
  const real = JSON.parse(readFileSync(join(REPO, 'web/connect/schema.json'), 'utf8'));
  const reasons = engineFarewellReasons();
  expect(reasons.length).toBeGreaterThan(0);
  const html = renderApiReference(real);
  for (const reason of reasons) expect(html).toContain(`<code>${reason}</code>`);
});
