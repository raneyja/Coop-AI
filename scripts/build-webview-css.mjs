import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'src/webview/globals.css');
const destination = path.join(root, 'dist/webview.css');
const watching = process.argv.includes('--watch');
let active = false;
let pending = false;

async function rebuild() {
  pending = true;
  if (active) return;
  active = true;
  try {
    while (pending) {
      pending = false;
      const result = await postcss([tailwind({base: root, optimize: !watching})]).process(await readFile(source, 'utf8'), {from: source, to: destination});
      await mkdir(path.dirname(destination), {recursive: true});
      await writeFile(destination, result.css);
      for (const warning of result.warnings()) console.warn(warning.toString());
      process.exitCode = 0;
      console.log('[webview-css] built');
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : String(error));
  } finally { active = false; }
}

if (watching) {
  let timer;
  const changed = () => {clearTimeout(timer);timer = setTimeout(() => void rebuild(), 50);};
  const watchers = [watch(path.join(root, 'src/webview'), {recursive: true}, changed), watch(path.join(root, 'tailwind.config.js'), changed)];
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => {clearTimeout(timer);for (const watcher of watchers) watcher.close();});
}
await rebuild();
