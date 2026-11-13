/**
 * Scenario: the README's notifications section shows example messages, so a
 * reader can see what a push says before turning them on.
 *
 * Expected behaviour: every quoted example in that section is a sentence the
 * English notification templates produce, with their placeholders filled in.
 */

import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const english = JSON.parse(
  fs.readFileSync(path.join(root, 'src/i18n/locales/en-GB.json'), 'utf8')
) as { notifications: { activityBody: Record<string, string> } };

const section = readme.slice(
  readme.indexOf('## Notifications'),
  readme.indexOf('## Backup and restore')
);
const examples = [...section.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');

const PLACEHOLDER = /(\{\{\w+\}\})/;

/** A template as a pattern: `{{delta}}` is a duration, other placeholders any text. */
function templatePattern(template: string): RegExp {
  const source = template
    .split(PLACEHOLDER)
    .map((part) => {
      if (part === '{{delta}}') return '\\d+ s|\\d+:\\d{2}';
      if (PLACEHOLDER.test(part)) return '.+';
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^(?:${source})$`);
}

describe('the README notification examples', () => {
  it('shows at least one example message', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples)('"%s" is a message the English templates produce', (example) => {
    const templates = Object.values(english.notifications.activityBody);
    expect(templates.some((template) => templatePattern(template).test(example))).toBe(true);
  });
});
