import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Simple KEY=VALUE configuration, so the project needs no dotenv dependency.
// OS environment variables win; do not use interpolation or multiline values.
// Always the project root .env, regardless of the working directory (v0.3F).
const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    const match=line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value=match[2];
    if ((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    process.env[match[1]]=value;
  }
}
