import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// The current immutable SQL files, not a guessed schema count, are the oracle.
export function migrationSourceManifest(directory = 'migrations') {
  const filenames = fs.readdirSync(directory).filter(name => /^\d{3}_\w+\.sql$/.test(name)).sort();
  if (!filenames.length || new Set(filenames.map(name => name.slice(0, 3))).size !== filenames.length) {
    throw new Error('Missing or duplicate migration source identity');
  }
  return filenames.map(filename => ({filename, checksum: createHash('sha256').update(fs.readFileSync(path.join(directory, filename))).digest('hex')}));
}
