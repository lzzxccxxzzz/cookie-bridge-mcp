// Reproducible gameplay acceptance through MCP; requires the isolated test runtime.
process.env.TEST_GROUP = 'goal';
await import('./integration-test.mjs');
