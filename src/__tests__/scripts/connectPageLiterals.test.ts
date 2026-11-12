/**
 * Scenario: a user-facing English literal in a connect page component stays
 * English when the language menu picks another locale.
 *
 * Expected behaviour: every string a component draws goes through `t(...)`,
 * so the `.tsx` files hold no literal that reads as text, in JSX or in a
 * value handed to one.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const DIR = path.join(__dirname, '../../../web/connect');

/** Literals that are names, keys and units rather than prose. */
const NOT_TEXT = new Set([
  'Veloq',
  'Ride',
  'Esc',
  'Escape',
  'ArrowRight',
  'ArrowLeft',
  'currentColor',
  'Fi',
]);

/** A capitalised word, or two words, in a string a component draws. */
const TEXT = /^[A-Z][a-z]+|[A-Za-z]{3,} [A-Za-z]{2,}/;

/** Attributes whose values are identifiers or geometry, never words. */
const TECHNICAL = new Set(['className', 'id', 'type', 'role', 'href', 'viewBox', 'scope', 'key']);

const isTranslationCall = (node: ts.Node) =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't';

function offences(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${path.basename(file)}:${line + 1} ${JSON.stringify(text)}`);
  };
  const visit = (node: ts.Node): void => {
    if (isTranslationCall(node)) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (/[A-Za-z]{2,}/.test(text) && !NOT_TEXT.has(text)) report(node, text);
    } else if (ts.isJsxAttribute(node)) {
      const value = node.initializer;
      if (!TECHNICAL.has(node.name.getText()) && value && ts.isStringLiteral(value)) {
        if (
          /[A-Za-z]{2,}/.test(value.text) &&
          !/^[a-z][A-Za-z-]*$/.test(value.text) &&
          !NOT_TEXT.has(value.text)
        )
          report(value, value.text);
      }
      return;
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (
        !NOT_TEXT.has(node.text) &&
        TEXT.test(node.text) &&
        !ts.isPropertyAssignment(node.parent)
      ) {
        report(node, node.text);
      }
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (TEXT.test(node.text.trim())) report(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('connect page literals', () => {
  const files = fs.readdirSync(DIR).filter((name) => name.endsWith('.tsx') && name !== 'main.tsx');

  it.each(files)('%s holds no user-facing literal outside t(...)', (name) => {
    expect(offences(path.join(DIR, name))).toEqual([]);
  });
});
