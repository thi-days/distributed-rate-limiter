import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load once at startup. EVAL avoids a script-cache retry path entirely.
export const consumeScript = readFileSync(join(__dirname, 'consume-script.lua'), 'utf8');
