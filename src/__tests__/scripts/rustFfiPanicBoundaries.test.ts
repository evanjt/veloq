import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const GUARD = join(ROOT, 'scripts/check-rust-ffi-panic-boundaries.mjs');

function runGuard(root: string): { status: number | null; output: string } {
  const result = spawnSync('node', [GUARD, '--root', root], { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function checkFixture(source: string): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rust-ffi-panic-'));
  try {
    writeFileSync(join(dir, 'entry.rs'), source);
    return runGuard(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it('rejects an unwrapped entry point even when another entry is wrapped', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub extern "C" fn wrapped() -> bool {
    crate::ffi_refuse_on_panic("wrapped", false, || true)
}
#[unsafe(no_mangle)]
pub extern "system" fn exposed() -> bool {
    true
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed must be enclosed by ffi_refuse_on_panic');
});

it('rejects work after a panic refusal call', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub extern "C" fn exposed() -> bool {
    crate::ffi_refuse_on_panic("first", false, || true);
    risky_work()
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed must be enclosed by ffi_refuse_on_panic');
});

it('allows a free function that only releases its input', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub unsafe extern "C" fn value_free(value: *mut u8) {
    if value.is_null() {
        return;
    }
    drop(unsafe { Box::from_raw(value) });
}`);
  expect(result).toEqual({ status: 0, output: '' });
});

it.each([
  ['refusal value', '"exposed", risky(), || true'],
  ['closure argument', '"exposed", false, { risky(); || true }'],
  ['label', 'label_from(risky()), false, || true'],
])('rejects work in the %s before the panic refusal', (_part, args) => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub extern "C" fn exposed() -> bool {
    crate::ffi_refuse_on_panic(${args})
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed must be enclosed by ffi_refuse_on_panic');
});

it.each([
  ['export_name', '#[unsafe(export_name = "exported_exposed")]', 'system'],
  ['no attribute', '', 'C'],
])('checks an extern function with %s', (_attribute, attribute, abi) => {
  const result = checkFixture(`
${attribute}
pub extern "${abi}" fn exposed() -> bool {
    risky()
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed must be enclosed by ffi_refuse_on_panic');
});

it('rejects a free function that runs work beyond releasing its input', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub unsafe extern "C" fn value_free(value: *mut u8) {
    risky();
    drop(unsafe { Box::from_raw(value) });
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('value_free must be enclosed by ffi_refuse_on_panic');
});

it('rejects a free function that drops a value other than its input', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub unsafe extern "C" fn value_free(value: *mut u8, other: *mut u8) {
    if value.is_null() {
        return;
    }
    drop(unsafe { Box::from_raw(other) });
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('value_free must be enclosed by ffi_refuse_on_panic');
});

it.each([
  ['C-unwind', 'extern "C-unwind"'],
  ['system-unwind', 'extern "system-unwind"'],
  ['implicit ABI', 'extern'],
])('rejects an unwrapped entry with %s', (_abi, declaration) => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub ${declaration} fn exposed() -> bool {
    risky()
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed');
});

it.each(['#[unsafe(no_mangle)]', '#[export_name = "exposed"]'])(
  'rejects %s in a macro definition',
  (attribute) => {
    const result = checkFixture(`
macro_rules! entry {
    ($name:ident) => {
        ${attribute}
        pub extern "C" fn $name() -> bool { risky() }
    };
}
entry!(exposed);`);
    expect(result.status).toBe(1);
    expect(result.output).toContain('macro_rules!');
  }
);

it('rejects a macro export even when its function name is literal', () => {
  const result = checkFixture(`
macro_rules! entry {
    () => {
        #[unsafe(no_mangle)]
        pub extern "C" fn exposed() -> bool {
            crate::ffi_refuse_on_panic("exposed", false, || true)
        }
    };
}
entry!();`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('macro_rules!');
});

it('rejects an unwrapped extern function with a comment between tokens', () => {
  const result = checkFixture(`
pub extern /* ABI follows */ "C" fn exposed() -> bool { risky() }`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed must be enclosed by ffi_refuse_on_panic');
});

it('rejects an exported macro with a comment between tokens', () => {
  const result = checkFixture(`
macro_rules! /* entry generator */ entry {
    () => {
        #[unsafe(no_mangle)]
        pub extern "C" fn exposed() -> bool {
            crate::ffi_refuse_on_panic("exposed", false, || true)
        }
    };
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('macro_rules!');
});

it('rejects an unsupported ABI even when its body is wrapped', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub extern "C-unwind" fn exposed() -> bool {
    crate::ffi_refuse_on_panic("exposed", false, || true)
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed has an unsupported extern ABI');
});

it('recognises an empty ABI string and refuses it', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub extern "" fn exposed() -> bool {
    crate::ffi_refuse_on_panic("exposed", false, || true)
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed has an unsupported extern ABI');
});

it('rejects an exported symbol attribute without a recognised entry', () => {
  const result = checkFixture(`
#[unsafe(export_name = "exposed")]
pub static VALUE: bool = true;`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exported symbol attribute has no recognised entry point');
});

it('recognises whitespace in an exported symbol attribute', () => {
  const result = checkFixture(`
# [no_mangle]
pub static VALUE: bool = true;`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exported symbol attribute has no recognised entry point');
});

it('rejects multiple exported symbol attributes for one entry', () => {
  const result = checkFixture(`
#[no_mangle]
#[unsafe(export_name = "exposed")]
pub extern "C" fn exposed() -> bool {
    crate::ffi_refuse_on_panic("exposed", false, || true)
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('symbol attributes');
});

it('accepts a wrapped entry with an implicit C ABI and a lifetime', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub extern fn exposed<'local>(value: &'local str) -> bool {
    crate::ffi_refuse_on_panic("exposed", false, || value == "}")
}`);
  expect(result).toEqual({ status: 0, output: '' });
});

it('allows a character literal inside a wrapped closure', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub extern "C" fn exposed() -> bool {
    crate::ffi_refuse_on_panic("exposed", false, || {
        let brace = '}';
        brace == '}'
    })
}`);
  expect(result).toEqual({ status: 0, output: '' });
});

it.each([
  ['an odd count of inner quotes', 'r#"say "hi"#'],
  ['a trailing backslash', 'r"C:\\"'],
  ['a byte raw string', 'br##"a "# b"##'],
  ['a C raw string', 'cr#"say "hi"#'],
])('sees an entry after a raw string with %s', (_shape, literal) => {
  const result = checkFixture(`
const S: &str = ${literal};
#[unsafe(no_mangle)]
pub extern "C" fn exposed() -> bool {
    risky()
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed must be enclosed by ffi_refuse_on_panic');
});

it('allows a raw string holding a brace inside a wrapped closure', () => {
  const result = checkFixture(`
#[unsafe(no_mangle)]
pub extern "C" fn exposed() -> bool {
    crate::ffi_refuse_on_panic("exposed", false, || r#"say "}"#.is_empty())
}
pub fn r#type() -> &'static str {
    r"C:\\"
}`);
  expect(result).toEqual({ status: 0, output: '' });
});

it.each([
  [
    'a meta fragment',
    '($attr:meta, $name:ident) => { #[$attr] pub fn $name() -> bool { risky() } };',
  ],
  [
    'an ident inside unsafe',
    '($a:ident, $name:ident) => { #[unsafe($a)] pub fn $name() -> bool { risky() } };',
  ],
])('rejects a macro that builds an attribute from %s', (_shape, rule) => {
  const result = checkFixture(`
macro_rules! entry {
    ${rule}
}
entry!(no_mangle, exposed);`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('macro_rules!');
});

it.each(['extern "C"', 'extern'])(
  'rejects a macro that declares an %s function without an attribute',
  (declaration) => {
    const result = checkFixture(`
macro_rules! entry {
    ($name:ident) => {
        pub ${declaration} fn $name() -> bool { risky() }
    };
}
entry!(exposed);`);
    expect(result.status).toBe(1);
    expect(result.output).toContain('macro_rules! declares an extern fn');
  }
);

it('allows a macro that names an extern function pointer type', () => {
  const result = checkFixture(`
macro_rules! callback {
    () => {
        let _: Option<extern "C" fn(i32) -> i32> = None;
    };
}`);
  expect(result).toEqual({ status: 0, output: '' });
});

it('sees an export attribute under cfg_attr', () => {
  const result = checkFixture(`
#[cfg_attr(target_os = "android", unsafe(no_mangle))]
pub fn exposed() -> bool {
    risky()
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exported symbol attribute has no recognised entry point');
});

it('checks an extern entry exported under cfg_attr', () => {
  const result = checkFixture(`
#[cfg_attr(target_os = "android", unsafe(no_mangle))]
pub extern "C" fn exposed() -> bool {
    risky()
}`);
  expect(result.status).toBe(1);
  expect(result.output).toContain('exposed must be enclosed by ffi_refuse_on_panic');
});
