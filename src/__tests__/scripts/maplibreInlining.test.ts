/**
 * Scenario: the renderer source carries characters above U+007F inside its own
 * string literals. Hermes stores a string holding even one of them as UTF-16,
 * so the inlined renderer and every page string built from it would take two
 * bytes per character.
 *
 * Expected behaviour: the text the generator embeds is pure ASCII once read
 * back as a string, and evaluating it as JavaScript gives the original values.
 */

const { forInlining } = require('../../../scripts/lib/maplibre-inlining.js');

// The generator writes the source through JSON.stringify into a TypeScript
// string literal, so the runtime value is what JSON.parse reads back.
const embedded = (source: string): string => JSON.parse(JSON.stringify(forInlining(source)));

const evaluate = (source: string, name: string): unknown =>
  new Function(`${source}; return ${name};`)();

describe('forInlining', () => {
  it('escapes a character above U+007F so the embedded value is ASCII', () => {
    const value = embedded('var a="︕"');
    expect(value).toMatch(/^[\x00-\x7f]*$/);
    expect(evaluate(value, 'a')).toBe('︕');
  });

  it('escapes both halves of a surrogate pair and keeps the character', () => {
    const value = embedded("var a='x\u{1F6B2}y'");
    expect(value).toMatch(/^[\x00-\x7f]*$/);
    expect(evaluate(value, 'a')).toBe('x\u{1F6B2}y');
  });

  it('escapes a character in an object key as well as a value', () => {
    const value = embedded('var gc={"é":"︕","!":"︖"}');
    expect(value).toMatch(/^[\x00-\x7f]*$/);
    expect(evaluate(value, 'gc')).toEqual({ é: '︕', '!': '︖' });
  });

  it('leaves an ASCII source unchanged', () => {
    const source = 'var a = "plain \\n text";';
    expect(embedded(source)).toBe(source);
  });

  it('still breaks a tag-closing sequence', () => {
    const value = embedded('var a="</script>"; var b="</SCRIPT>";');
    expect(value).not.toMatch(/<\/script/i);
    expect(evaluate(value, 'a')).toBe('</script>');
    expect(evaluate(value, 'b')).toBe('</SCRIPT>');
  });
});
