import assert from 'assert';
import { buildRequestHeaders, type RemoteServerConfig } from '../../src/tools/mcp/client';

function config(overrides: Partial<RemoteServerConfig> = {}): RemoteServerConfig {
  return {
    type: 'streamable-http',
    name: 'calendar',
    url: 'https://example.com/mcp',
    ...overrides,
  };
}

assert.strictEqual(buildRequestHeaders(config()), undefined);

assert.deepStrictEqual(
  buildRequestHeaders(config({
    auth: { type: 'basic', username: 'adam', password: 'calendar_data_access_2025' },
  })),
  {
    Authorization: `Basic ${Buffer.from('adam:calendar_data_access_2025').toString('base64')}`,
  },
);

assert.deepStrictEqual(
  buildRequestHeaders(config({
    auth: { type: 'bearer', token: 'secret-token' },
    headers: { 'X-Custom-Header': 'custom-value' },
  })),
  {
    'X-Custom-Header': 'custom-value',
    Authorization: 'Bearer secret-token',
  },
);

assert.deepStrictEqual(
  buildRequestHeaders(config({
    auth: { type: 'basic', username: 'user', password: 'password' },
    headers: { Authorization: 'Bearer legacy-token' },
  })),
  {
    Authorization: `Basic ${Buffer.from('user:password').toString('base64')}`,
  },
);

console.log('MCP auth tests passed');
