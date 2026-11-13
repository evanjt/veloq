import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-canvas-owner.mjs');

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'canvas-owner-'));
  for (const [rel, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), source);
  }
  try {
    execFileSync('node', [script, '--root', root], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { failed: false, output: '' };
  } catch (error) {
    const failure = error as { stderr?: Buffer };
    return { failed: true, output: failure.stderr?.toString() ?? '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const owner = {
  'src/shared/ui/SkiaCanvas.tsx':
    "import { Canvas as RawCanvas } from '@shopify/react-native-skia';\nexport const Canvas = RawCanvas;\n",
};

it('passes a tree that draws its canvases through the owner', () => {
  const result = check({
    ...owner,
    'src/features/Orchard.tsx': [
      "import { Path, Skia, type CanvasProps } from '@shopify/react-native-skia';",
      "import type { Canvas as CanvasType } from '@shopify/react-native-skia';",
      "import { Canvas } from '@/shared/ui/SkiaCanvas';",
      '',
    ].join('\n'),
    'src/__tests__/Orchard.test.tsx': "import { Canvas } from '@shopify/react-native-skia';\n",
  });
  expect(result).toEqual({ failed: false, output: '' });
});

it.each([
  "import { Path, Canvas } from '@shopify/react-native-skia';",
  "import { Canvas as Board } from '@shopify/react-native-skia';",
  "import {\n  Canvas,\n  Path,\n} from '@shopify/react-native-skia';",
])('refuses %s outside the owner and names the file and line', (line) => {
  const result = check({ ...owner, 'src/features/Orchard.tsx': `export {};\n${line}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/Orchard.tsx:2');
  expect(result.output).toContain('SkiaCanvas');
});

it('refuses a tree with no owner', () => {
  const result = check({ 'src/features/Orchard.tsx': 'export {};\n' });
  expect(result.failed).toBe(true);
});
