/**
 * Scenario: a build from before place names were withdrawn still asks the
 * worker which geocoder to use, while the worker's environment carries an
 * endpoint from an older deploy.
 *
 * Expected behaviour: the answer is always a stop, so an old install sends no
 * point to any geocoder.
 */
const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const request = new Request('https://auth.example/geocoder');

it.each([
  ['an endpoint left in the environment', { GEOCODER_ENDPOINT: 'https://places.example' }],
  ['no endpoint at all', {}],
])('serves a stop for one day with %s', async (_label, env) => {
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ endpoint: null });
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
});
