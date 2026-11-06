import { rm } from 'node:fs/promises';
import path from 'node:path';

await rm(path.join(process.cwd(), '.data', 'studio.json'), { force: true });
console.log('Demo data reset. Restart or refresh the application.');
