import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';
import { createHome, type Home } from './harness.js';

describe('e2e: doctor', { timeout: 60_000 }, () => {
  let home: Home;
  afterEach(() => home?.remove());

  const adoRepo = { name: 'demo', provider: 'azure-devops', organization: 'o', project: 'p', repo: 'demo' };

  it('accepts an Azure DevOps bearer in place of a PAT, as a run does', async () => {
    home = createHome();
    home.writeConfig([adoRepo]);

    const result = await home.run(['doctor'], { env: { REPOSCOUT_ADO_BEARER: 'bearer-from-the-pipeline', REPOSCOUT_ADO_PAT: '' } });

    assert.match(result.stdout, /^ok {3}Azure DevOps bearer in REPOSCOUT_ADO_BEARER: set; used instead of a PAT$/m);
    assert.doesNotMatch(result.stdout, /PAT in REPOSCOUT_ADO_PAT/);
    assert.doesNotMatch(result.stdout, /bearer-from-the-pipeline/);
  });

  it('still requires the PAT without a bearer', async () => {
    home = createHome();
    home.writeConfig([adoRepo]);

    const result = await home.run(['doctor'], { env: { REPOSCOUT_ADO_BEARER: '', REPOSCOUT_ADO_PAT: '' } });

    assert.match(result.stdout, /^FAIL PAT in REPOSCOUT_ADO_PAT:/m);
    assert.equal(result.code, 1);
  });
});
