/**
 * Scenario: the accessibility bar says every pressable carries a role and a
 * label, and that the label says what the control does rather than naming its
 * icon. The shared components are where that is cheapest to hold, because a
 * screen that adopts one inherits it.
 *
 * Expected behaviour: no pressable under `src/shared/ui` is left without both.
 * Read from the source: rendering nine components to count props is a mock
 * tower, and what is being asserted is a property of the files.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const UI_DIR = join(__dirname, '../../shared/ui');

/** Every opening `<TouchableOpacity …>` or `<Pressable …>` tag in a file. */
function pressableTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<(TouchableOpacity|Pressable|AnimatedPressable)\b/g)) {
    const start = match.index;
    // The opening tag ends at the first `>` outside a brace-delimited prop.
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      const c = source[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) {
        tags.push(source.slice(start, i));
        break;
      }
    }
  }
  return tags;
}

const FILES = readdirSync(UI_DIR)
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => [name, readFileSync(join(UI_DIR, name), 'utf8')] as const);

describe('pressableTags', () => {
  it('stops at the tag, not at a `>` inside a prop expression', () => {
    const [tag] = pressableTags('<Pressable onPress={() => go()} accessibilityRole="button">x');

    expect(tag).toContain('accessibilityRole');
    expect(tag).not.toContain('x');
  });

  it('finds every tag in a file, not only the first', () => {
    expect(pressableTags('<Pressable a>\n<TouchableOpacity b>')).toHaveLength(2);
  });
});

describe('every pressable in the shared components', () => {
  const tags = FILES.flatMap(([name, source]) =>
    pressableTags(source).map((tag) => [name, tag] as const)
  );

  it('finds the pressables at all, so a passing run is not an empty one', () => {
    expect(tags.length).toBeGreaterThan(10);
  });

  it.each(FILES.map(([name]) => name))('carries a role on every pressable in %s', (name) => {
    const missing = tags
      .filter(([file]) => file === name)
      .filter(([, tag]) => !tag.includes('accessibilityRole') && !tag.includes('{...props}'));

    expect(missing.map(([, tag]) => tag.slice(0, 60))).toEqual([]);
  });

  it.each(FILES.map(([name]) => name))('carries a label on every pressable in %s', (name) => {
    const missing = tags
      .filter(([file]) => file === name)
      .filter(
        ([, tag]) =>
          !tag.includes('accessibilityLabel') &&
          !tag.includes('accessibilityLabelledBy') &&
          !tag.includes('{...props}')
      );

    expect(missing.map(([, tag]) => tag.slice(0, 60))).toEqual([]);
  });
});
