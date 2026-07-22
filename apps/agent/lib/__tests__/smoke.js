/**
 * Smoke tests do agent (sem jest no package agent — roda via node assert).
 * Uso: node apps/agent/lib/__tests__/smoke.js
 */
const assert = require('assert');
const path = require('path');

// agent-update exporta applyAgentUpdate
const { applyAgentUpdate } = require('../agent-update');
assert.strictEqual(typeof applyAgentUpdate, 'function');

// sem downloadUrl → false
applyAgentUpdate(null, {
  token: 't',
  apiUrl: 'http://localhost',
  log: () => {},
  logError: () => {},
}).then((r) => {
  assert.strictEqual(r, false);
  console.log('agent smoke ok:', path.basename(__filename));
});
