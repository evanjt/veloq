/**
 * C++ reserved words, and the check that keeps them out of UniFFI argument
 * names.
 *
 * The C++ codegen copies a Rust argument name verbatim into the generated
 * bridge, so an export taking `template: String` compiles in Rust, passes the
 * manifest check and type checks in TypeScript, then fails inside CMake on the
 * only platform that builds C++. That costs a full Android build to surface,
 * which is why it is caught here instead.
 */

/**
 * The C++23 keyword list, plus the alternative operator spellings, which are
 * reserved too. `override` and `final` are contextual and legal as a parameter
 * name, so they are not here.
 */
export const CPP_KEYWORDS: ReadonlySet<string> = new Set([
  'alignas',
  'alignof',
  'and',
  'and_eq',
  'asm',
  'atomic_cancel',
  'atomic_commit',
  'atomic_noexcept',
  'auto',
  'bitand',
  'bitor',
  'bool',
  'break',
  'case',
  'catch',
  'char',
  'char8_t',
  'char16_t',
  'char32_t',
  'class',
  'co_await',
  'co_return',
  'co_yield',
  'compl',
  'concept',
  'const',
  'consteval',
  'constexpr',
  'constinit',
  'const_cast',
  'continue',
  'decltype',
  'default',
  'delete',
  'do',
  'double',
  'dynamic_cast',
  'else',
  'enum',
  'explicit',
  'export',
  'extern',
  'false',
  'float',
  'for',
  'friend',
  'goto',
  'if',
  'inline',
  'int',
  'long',
  'mutable',
  'namespace',
  'new',
  'noexcept',
  'not',
  'not_eq',
  'nullptr',
  'operator',
  'or',
  'or_eq',
  'private',
  'protected',
  'public',
  'reflexpr',
  'register',
  'reinterpret_cast',
  'requires',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'static_assert',
  'static_cast',
  'struct',
  'switch',
  'synchronized',
  'template',
  'this',
  'thread_local',
  'throw',
  'true',
  'try',
  'typedef',
  'typeid',
  'typename',
  'union',
  'unsigned',
  'using',
  'virtual',
  'void',
  'volatile',
  'wchar_t',
  'while',
  'xor',
  'xor_eq',
]);

/** An export as the extractor records it, narrowed to what this check reads. */
export interface KeywordCheckTarget {
  name: string;
  object?: string;
  file: string;
  line: number;
  params: string[];
}

/**
 * The bare identifier a Rust parameter declares, with any `mut` binding mode
 * and surrounding whitespace removed.
 */
function parameterName(param: string): string {
  return param.trim().replace(/^mut\s+/, '').trim();
}

export function isCppKeyword(name: string): boolean {
  return CPP_KEYWORDS.has(parameterName(name));
}

/**
 * One line per offending argument, naming the export, the argument and where
 * it is declared. Empty when every argument is safe.
 */
export function findCppKeywordParams(exports: KeywordCheckTarget[]): string[] {
  const offenders: string[] = [];
  for (const exp of exports) {
    for (const param of exp.params) {
      if (!isCppKeyword(param)) continue;
      const qualified = exp.object ? `${exp.object}::${exp.name}` : exp.name;
      offenders.push(
        `${qualified}(${parameterName(param)}) at ${exp.file}:${exp.line} - ` +
          `'${parameterName(param)}' is a C++ keyword and the generated bridge will not compile`
      );
    }
  }
  return offenders;
}
