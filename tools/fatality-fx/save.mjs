// Saves what the bench page posts into docs/: node tools/fatality-fx/save.mjs, then window.bench.save('fatality-fx-mage.png').
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = fileURLToPath(new URL('../../docs/', import.meta.url));
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  const name = basename(new URL(req.url, 'http://localhost').searchParams.get('name') ?? '');
  if (req.method !== 'POST' || !/^fatality-fx-[a-z]+\.png$/.test(name)) {
    res.end(req.method === 'OPTIONS' ? '' : 'no');
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    writeFileSync(join(docs, name), Buffer.concat(chunks));
    res.end(`saved docs/${name}`);
  });
}).listen(5189, '127.0.0.1');
