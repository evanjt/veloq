/**
 * Scenario: 134 suites mock the engine binding through one stub, and the
 * stub is held to Rust on two enums and nothing else. A method the binding
 * dropped, a member the stub never had, or a default that returns the wrong
 * kind of value passes every one of them.
 *
 * Expected behaviour: every value the stub exports is one the binding
 * exports, every member of its engine and preview stand-ins is one the real
 * client declares with a default of the declared kind, and every override a
 * test writes names a member that exists. Read from the binding's own
 * TypeScript source, since the generated module cannot be imported here.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

import * as stub from '../__shared__/veloqrsStub';

const BINDING = resolve('modules/veloqrs/src');
const TESTS = resolve('src/__tests__');

/** Stub-only helpers a test may import; each stands in for a declared shape. */
const HELPERS = new Set(['createPreviewClientStub', 'withOverrides']);

type Member = { kind: 'method' | 'getter' | 'value'; type: ts.TypeNode | undefined };
type Surface = { members: Map<string, Member>; aliases: Map<string, ts.TypeNode> };

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** Value names a module exports, following `export *` one level down. */
function valueExports(file: string): Set<string> {
  const names = new Set<string>();
  const source = parse(file);
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) continue;
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) if (!el.isTypeOnly) names.add(el.name.text);
      } else if (
        !node.exportClause &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const target = resolve(join(file, '..', `${node.moduleSpecifier.text}.ts`));
        for (const name of valueExports(target)) names.add(name);
      }
      continue;
    }
    if (!isExported(node)) continue;
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      if (node.name) names.add(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations)
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
    }
  }
  return names;
}

/** The type aliases a file declares, so a reference to one can be read through. */
function aliasesIn(source: ts.SourceFile): Map<string, ts.TypeNode> {
  const aliases = new Map<string, ts.TypeNode>();
  for (const s of source.statements) {
    if (ts.isTypeAliasDeclaration(s)) aliases.set(s.name.text, s.type);
  }
  return aliases;
}

/** The members of the `EngineClient` class: methods, getters and arrow properties. */
function engineSurface(): Surface {
  const members = new Map<string, Member>();
  const source = parse(join(BINDING, 'EngineClient.ts'));
  const klass = source.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'EngineClient'
  );
  if (!klass) throw new Error('EngineClient.ts declares no EngineClient class');
  for (const m of klass.members) {
    if (!m.name || !ts.isIdentifier(m.name)) continue;
    if (ts.isMethodDeclaration(m)) members.set(m.name.text, { kind: 'method', type: m.type });
    else if (ts.isGetAccessor(m)) members.set(m.name.text, { kind: 'getter', type: m.type });
    else if (ts.isPropertyDeclaration(m)) {
      const init = m.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))
        members.set(m.name.text, { kind: 'method', type: init.type });
      else members.set(m.name.text, { kind: 'value', type: m.type });
    }
  }
  return { members, aliases: aliasesIn(source) };
}

/** The members of the `PreviewClient` interface. */
function previewSurface(): Surface {
  const members = new Map<string, Member>();
  const source = parse(join(BINDING, 'delegates', 'preview.ts'));
  const iface = source.statements.find(
    (s): s is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(s) && s.name.text === 'PreviewClient'
  );
  if (!iface) throw new Error('delegates/preview.ts declares no PreviewClient interface');
  for (const m of iface.members) {
    if (!m.name || !ts.isIdentifier(m.name)) continue;
    if (ts.isMethodSignature(m)) members.set(m.name.text, { kind: 'method', type: m.type });
    else if (ts.isPropertySignature(m)) members.set(m.name.text, { kind: 'value', type: m.type });
  }
  return { members, aliases: aliasesIn(source) };
}

/**
 * Whether a default the stub returns is of the declared kind. A reference
 * type wants an object, so a stub answering `undefined` where the binding
 * promises a record is the fabricated absence this guards against. An alias
 * declared beside the surface is read through; one imported from elsewhere
 * is taken as a record.
 */
function ofKind(value: unknown, type: ts.TypeNode | undefined, surface: Surface): boolean {
  if (type === undefined) return true;
  switch (type.kind) {
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
      return value === undefined;
    case ts.SyntaxKind.BooleanKeyword:
      return typeof value === 'boolean';
    case ts.SyntaxKind.NumberKeyword:
      return typeof value === 'number';
    case ts.SyntaxKind.StringKeyword:
      return typeof value === 'string';
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.AnyKeyword:
      return true;
  }
  if (ts.isArrayTypeNode(type)) return Array.isArray(value);
  if (ts.isUnionTypeNode(type)) return type.types.some((t) => ofKind(value, t, surface));
  if (ts.isParenthesizedTypeNode(type)) return ofKind(value, type.type, surface);
  if (ts.isLiteralTypeNode(type)) {
    if (type.literal.kind === ts.SyntaxKind.NullKeyword) return value === null;
    if (ts.isStringLiteral(type.literal)) return value === type.literal.text;
    return true;
  }
  if (ts.isFunctionTypeNode(type)) return typeof value === 'function';
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    if (type.typeName.text === 'Promise') return value instanceof Promise;
    if (type.typeName.text === 'Array') return Array.isArray(value);
    const alias = surface.aliases.get(type.typeName.text);
    if (alias) return ofKind(value, alias, surface);
  }
  return typeof value === 'object' && value !== null;
}

function describeType(type: ts.TypeNode | undefined): string {
  return type ? type.getText() : '(inferred)';
}

/** The stub's defaults for a stand-in, held to the surface it stands in for. */
function wrongDefaults(standIn: Record<string, unknown>, surface: Surface): string[] {
  const wrong: string[] = [];
  for (const [name, value] of Object.entries(standIn)) {
    const member = surface.members.get(name);
    if (!member) continue;
    if (member.kind === 'method') {
      if (typeof value !== 'function') {
        wrong.push(`${name}: the binding declares a method`);
        continue;
      }
      const answer = (value as () => unknown)();
      if (!ofKind(answer, member.type, surface))
        wrong.push(`${name}: default ${String(answer)} is not ${describeType(member.type)}`);
    } else if (!ofKind(value, member.type, surface)) {
      wrong.push(`${name}: ${String(value)} is not ${describeType(member.type)}`);
    }
  }
  return wrong;
}

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return testFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

type Override = { file: string; key: string; members: string[] };

/** Every `withOverrides({...})` in the tree: its keys and, for an object, its members. */
function overrides(): Override[] {
  const found: Override[] = [];
  for (const file of testFiles(TESTS)) {
    const source = parse(file);
    const visit = (node: ts.Node) => {
      const callee = ts.isCallExpression(node) ? node.expression : undefined;
      const named =
        callee &&
        ((ts.isPropertyAccessExpression(callee) && callee.name.text === 'withOverrides') ||
          (ts.isIdentifier(callee) && callee.text === 'withOverrides'));
      const arg = named && ts.isCallExpression(node) ? node.arguments[0] : undefined;
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (!prop.name || !ts.isIdentifier(prop.name)) continue;
          const members: string[] = [];
          if (ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
            for (const inner of prop.initializer.properties)
              if (inner.name && ts.isIdentifier(inner.name)) members.push(inner.name.text);
          }
          found.push({ file: relative(TESTS, file), key: prop.name.text, members });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe("the binding stub holds the binding's shape", () => {
  const binding = valueExports(join(BINDING, 'index.ts'));
  const engine = engineSurface();
  const preview = previewSurface();

  it('exports only values the binding exports, plus its documented helpers', () => {
    const foreign = Object.keys(stub.withOverrides()).filter(
      (name) => !binding.has(name) && !HELPERS.has(name)
    );
    expect(foreign).toEqual([]);
  });

  it('gives its engine only members EngineClient declares, of the declared kind', () => {
    const foreign = Object.keys(stub.engine).filter((name) => !engine.members.has(name));
    expect(foreign).toEqual([]);
    expect(wrongDefaults(stub.engine, engine)).toEqual([]);
  });

  it('gives its preview client exactly the PreviewClient members, of the declared kind', () => {
    const client = stub.createPreviewClientStub() as Record<string, unknown>;
    const missing = [...preview.members.keys()].filter((name) => !(name in client));
    const foreign = Object.keys(client).filter((name) => !preview.members.has(name));
    expect({ missing, foreign }).toEqual({ missing: [], foreign: [] });
    expect(wrongDefaults(client, preview)).toEqual([]);
  });

  it('is overridden only on names the binding has', () => {
    const wrong: string[] = [];
    for (const { file, key, members } of overrides()) {
      if (!binding.has(key) && !HELPERS.has(key))
        wrong.push(`${file}: ${key} is not a binding export`);
      if (key === 'engine')
        for (const m of members)
          if (!engine.members.has(m)) wrong.push(`${file}: engine.${m} is not on EngineClient`);
    }
    expect(wrong).toEqual([]);
  });
});
