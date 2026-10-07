#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(root, 'package.json'));
const priorEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
let config;
try {
  config = require(resolve(root, 'babel.config.js'))({ cache() {} });
} catch (error) {
  console.error(`check-production-console: cannot load Babel config: ${error.message}`);
  process.exit(1);
} finally {
  if (priorEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorEnv;
}

const strips = config.plugins?.filter(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'transform-remove-console'
);
if (strips?.length !== 1 || JSON.stringify(strips[0][1]?.exclude) !== '["error"]') {
  console.error('check-production-console: production must use transform-remove-console with only error excluded');
  process.exit(1);
}
console.log('check-production-console: production console strip configured');
