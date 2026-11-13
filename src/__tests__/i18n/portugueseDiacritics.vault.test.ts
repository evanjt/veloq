/**
 * Scenario: `pt` and `pt-BR` strings were written without their accents, the
 * destructive confirmations among them ("nao pode ser desfeita", "sera excluido").
 * A missing accent can change the word: "e" for "é", "ha" for "há".
 *
 * Expected behaviour: no string in either bundle carries the unaccented form of a
 * word that Portuguese spells with a diacritic.
 */
import pt from '@/i18n/locales/pt.json';
import ptBR from '@/i18n/locales/pt-BR.json';

const STRIPPED_WORDS = [
  'acao',
  'aerobico',
  'aparecerao',
  'aparencia',
  'aplicacao',
  'apos',
  'atras',
  'calendario',
  'cardiaca',
  'cartoes',
  'codigo',
  'comecara',
  'comparacao',
  'conclusao',
  'concluida',
  'concluido',
  'condicao',
  'condicoes',
  'conteudo',
  'correspondencia',
  'definicoes',
  'diario',
  'disponiveis',
  'distancia',
  'distribuicao',
  'duracao',
  'eficiencia',
  'eliminara',
  'esforco',
  'esforcos',
  'especifico',
  'estatisticas',
  'exportacao',
  'frequencia',
  'ginasio',
  'icone',
  'informacoes',
  'invalida',
  'invalido',
  'licenca',
  'licencas',
  'ligacao',
  'localizacao',
  'metricas',
  'natacao',
  'nao',
  'noticia',
  'obrigatoria',
  'orientacao',
  'otima',
  'otimo',
  'periodo',
  'permissao',
  'politica',
  'pontuacao',
  'possivel',
  'potencia',
  'proxima',
  'quao',
  'rapido',
  'recuperacao',
  'relacao',
  'repositorio',
  'ruido',
  'satelite',
  'sao',
  'seguranca',
  'selecao',
  'sensacao',
  'serao',
  'servico',
  'sessao',
  'sincronizacao',
  'suavizacao',
  'tendencia',
  'tendencias',
  'transicao',
  'ultima',
  'ultimo',
  'ultimos',
  'varias',
  'versao',
  'visualizacao',
  'voce',
  'excluira',
  'faca',
  'conexao',
  'configuracoes',
  'padrao',
  'restauracao',
  'referencia',
  'movel',
  'area',
  'ha',
  'mes',
  'ira',
  'tera',
  'series',
];

function flatten(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, [...path, k])
  );
}

const STRIPPED = new RegExp(
  `(?<![\\p{L}\\p{N}])(${STRIPPED_WORDS.join('|')})(?![\\p{L}\\p{N}])`,
  'iu'
);

function strippedStrings(bundle: unknown): string[] {
  return flatten(bundle)
    .filter(([, value]) => STRIPPED.test(value.replace(/\{\{[^}]*\}\}/g, '')))
    .map(([key, value]) => `${key}: ${value}`);
}

describe('Portuguese diacritics', () => {
  it('pt carries no unaccented form of an accented word', () => {
    expect(strippedStrings(pt)).toEqual([]);
  });

  it('pt-BR carries no unaccented form of an accented word', () => {
    expect(strippedStrings(ptBR)).toEqual([]);
  });

  it('the destructive account-change confirmation keeps its accents', () => {
    const message = flatten(ptBR).find(([k]) => k === 'alerts.disconnectAndClearMessage')?.[1];
    expect(message).toContain('Esta ação não pode ser desfeita');
  });
});
