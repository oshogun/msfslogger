import path from 'node:path';
import { fileURLToPath } from 'node:url';

// client/package.json declares "type": "module": Playwright loads these files
// as ESM, where __dirname does not exist.
const here = path.dirname(fileURLToPath(import.meta.url));

export const E2E_DIR = path.resolve(here, '..');
export const STORAGE_STATE = path.join(E2E_DIR, '.auth', 'operator.json');
