const worker = require('../../../oauth-proxy/src/worker').default as {
  fetch: (request: Request, env: unknown) => Promise<Response>;
};

const request = new Request('https://auth.example/geocoder');

it('serves the configured geocoder endpoint for one day', async () => {
  const response = await worker.fetch(request, {
    GEOCODER_ENDPOINT: 'https://places.example',
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ endpoint: 'https://places.example' });
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
});

it('serves a stop when the worker variable says stop', async () => {
  const response = await worker.fetch(request, { GEOCODER_ENDPOINT: 'stop' });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ endpoint: null });
});
