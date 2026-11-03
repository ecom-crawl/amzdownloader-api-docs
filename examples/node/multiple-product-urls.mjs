import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient, extract} from './client.mjs';

export async function collectProducts(request, urls, runId, checkpoint = async () => {}) {
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 10 || !urls.every(url => typeof url === 'string' && url.startsWith('https://'))) throw new Error('Provide a JSON array containing 1 to 10 HTTPS product URLs');
  if (!/^[!-~]{1,80}$/.test(runId)) throw new Error('Use a stable run ID with 1 to 80 printable non-space characters');
  if (new Set(urls).size !== urls.length) throw new Error('Remove duplicate URLs before starting');
  const results = [];
  for (const [index, url] of urls.entries()) {
    // Sequential iteration over the single-product endpoint, with no bulk API.
    const operationId = `${runId}:${index + 1}`;
    const media = await extract(request, url, {idempotencyKey: operationId, maxPolls: 20});
    results.push({inputUrl: url, operationId, result: media});
    await checkpoint({runId, urls, results});
  }
  return results;
}
async function main() {
  const [input, output] = process.argv.slice(2);
  const runId = process.env.AMZDOWNLOADER_RUN_ID;
  if (!input || !output || !runId) throw new Error('Usage: AMZDOWNLOADER_RUN_ID=stable-id node examples/node/multiple-product-urls.mjs urls.json results.json');
  const urls = JSON.parse(await readFile(input, 'utf8'));
  const results = await collectProducts(createClient(), urls, runId, state => writeFile(output, JSON.stringify(state, null, 2)));
  console.log(JSON.stringify({completedProducts: results.length, output}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {console.error(error.message);process.exitCode = 1;});
