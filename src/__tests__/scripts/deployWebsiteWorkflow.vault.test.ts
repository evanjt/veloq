/**
 * Scenario: the connect page is built from web/connect/ and docs/connect/ is
 * not tracked, so a deploy that uploads docs/ without building publishes a
 * site with no page.
 *
 * Expected behaviour: the deploy installs, builds the page and checks it before
 * it uploads, and runs for a change to anything the build reads.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Step = { name?: string; uses?: string; run?: string };
type Workflow = {
  on: { push: { paths: string[] } };
  jobs: { deploy: { steps: Step[] } };
};

const workflow = yaml.load(
  readFileSync(join(ROOT, '.github/workflows/deploy-website.yml'), 'utf8')
) as Workflow;
const steps = workflow.jobs.deploy.steps;
const at = (match: (step: Step) => boolean) => steps.findIndex(match);

describe('deploy website workflow', () => {
  const install = at((step) => (step.uses ?? '').includes('npm-ci'));
  const build = at((step) => step.run === 'npm run build:connect');
  const check = at((step) => step.run === 'npm run check:connect-page-local');
  const upload = at((step) => (step.uses ?? '').startsWith('actions/upload-pages-artifact'));

  it('installs, builds and checks the page, in that order, before it uploads', () => {
    expect(install).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(install);
    expect(check).toBeGreaterThan(build);
    expect(upload).toBeGreaterThan(check);
  });

  it('runs for every file the build reads', () => {
    expect(workflow.on.push.paths).toEqual(
      expect.arrayContaining([
        'docs/**',
        'web/connect/**',
        'package-lock.json',
        'scripts/build-connect-page.mjs',
      ])
    );
  });
});
