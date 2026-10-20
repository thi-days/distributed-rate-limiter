import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv } from 'node:process';

const outputDirectory = argv[2];
if (!outputDirectory) throw new Error('Usage: node scripts/copy-lua.mjs <compiled source directory>');

const repositoryRoot = resolve(import.meta.dirname, '..');
const scriptPath = 'stores/redis/consume-script.lua';
const destination = join(repositoryRoot, outputDirectory, scriptPath);

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(join(repositoryRoot, 'src', scriptPath), destination);
