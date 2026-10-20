import { loadConfiguration } from './config.js';

export { ConfigurationError, loadConfiguration } from './config.js';
export type { Configuration, Policy } from './config.js';

if (require.main === module) {
  try {
    loadConfiguration();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid rate limit configuration');
    process.exitCode = 1;
  }
}
