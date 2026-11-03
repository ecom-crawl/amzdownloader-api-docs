import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient, jobPath} from './client.mjs';

export async function extractVideos(request, url, operationId, {wait = ms => new Promise(resolve => setTimeout(resolve, ms)), maxPolls = 20} = {}) {
  const created = await request('POST', '/scrapes', {
    url, renderMode: 'auto',
    include: {productImages: false, variantImages: false, productVideos: true, relatedVideos: false, creatorVideos: false},
  }, operationId);
  if (created.status === 200 && created.data.status === 'completed') return created.data;
  if (created.status !== 202) throw new Error('Expected completed media or a queued job');
  const jobId = created.data.jobId;
  const route = jobPath(jobId, '/result');
  console.error(`Save this job ID: ${jobId}`);
  for (let poll = 0; poll < maxPolls; poll++) {
    await wait(3000);
    const response = await request('GET', route);
    if (response.status === 200 && response.data.status === 'completed') return response.data;
    if (response.status !== 202 || !['queued', 'processing'].includes(response.data.status)) throw new Error(`Extraction stopped; inspect job ${jobId}`);
  }
  throw new Error(`Polling limit reached; check saved job ${jobId}`);
}
export async function selectDownload(request, result, operationId, convert = false) {
  const videos = result.data.media.productVideos;
  const direct = videos.find(video => {try {const url = new URL(video.src);return url.protocol === 'https:' && url.pathname.toLowerCase().endsWith('.mp4');} catch {return false;}});
  if (direct) return {url: direct.src, converted: false};
  if (!convert) return null;
  const hls = videos.find(video => {try {const url = new URL(video.src);return url.protocol === 'https:' && (url.hostname === 'm.media-amazon.com' || url.hostname.endsWith('.media-amazon.com')) && url.pathname.toLowerCase().endsWith('.m3u8');} catch {return false;}});
  if (!hls) return null;
  const response = await request('POST', '/videos/convert', {url: hls.src}, `${operationId}:mp4`);
  return {url: response.data.url, converted: true};
}
export async function downloadMp4(url, target, fetcher = fetch) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) throw new Error('Expected an HTTPS download URL');
  // Returned media downloads never receive the AmzDownloader API key.
  const response = await fetcher(parsed, {redirect: 'error', signal: AbortSignal.timeout(60000)});
  if (!response.ok || !response.body) throw new Error('Video download failed');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 64 * 1024 * 1024) throw new Error('Video exceeds this example\'s 64 MB download limit');
    chunks.push(Buffer.from(chunk));
  }
  await writeFile(target, Buffer.concat(chunks), {flag: 'wx'});
}
async function main() {
  const [url, outputDirectory, option] = process.argv.slice(2);
  if (!url || !outputDirectory || (option && option !== '--convert')) throw new Error('Usage: node examples/node/download-videos.mjs PRODUCT_URL OUTPUT_DIRECTORY [--convert]');
  const operationId = process.env.AMZDOWNLOADER_IDEMPOTENCY_KEY;
  if (!operationId || !/^[!-~]{1,80}$/.test(operationId)) throw new Error('Set a stable AMZDOWNLOADER_IDEMPOTENCY_KEY with 1 to 80 printable non-space characters');
  const request = createClient();
  const result = await extractVideos(request, url, operationId);
  await mkdir(outputDirectory, {recursive: true});
  await writeFile(path.join(outputDirectory, 'media-result.json'), JSON.stringify(result, null, 2));
  const selected = await selectDownload(request, result, operationId, option === '--convert');
  if (selected) await downloadMp4(selected.url, path.join(outputDirectory, 'video-001.mp4'));
  console.log(JSON.stringify({productVideos: result.data.media.productVideos.length, downloaded: Boolean(selected), converted: selected?.converted ?? false, warnings: result.data.warnings}, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {console.error(error.message);process.exitCode = 1;});
