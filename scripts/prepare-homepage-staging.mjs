// Assemble only the checksum-pinned staging runtime; never reads credentials.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [sourcePath, output] = process.argv.slice(2);
if (!sourcePath || !output) throw new Error('Usage: node scripts/prepare-homepage-staging.mjs <source-export.json> <output-directory>');
const root = new URL('../staging/homepage-checkout/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('source-manifest.json', root), 'utf8'));
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const files = Array.isArray(source) ? source : source.files;
for (const [name, expected] of Object.entries(manifest.billingFiles)) {
  const matches = files.filter(file => file.name.endsWith('/internal/' + name));
  if (matches.length !== 1 || createHash('sha256').update(matches[0].content).digest('hex') !== expected) {
    throw new Error('Reviewed staging source mismatch: ' + name);
  }
}
await mkdir(path.join(output, 'billing'), { recursive: true });
for (const name of Object.keys(manifest.billingFiles)) {
  const file = files.find(file => file.name.endsWith('/internal/' + name));
  await writeFile(path.join(output, 'billing', name), file.content);
}
for (const name of ['index.ts', 'preview-policy.mjs']) await copyFile(new URL(name, root), path.join(output, name));
console.log('Assembled checksum-verified staging-only checkout runtime. No deployment performed.');
