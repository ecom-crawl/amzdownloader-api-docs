import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {extractVideos,selectDownload,downloadMp4} from '../examples/node/download-videos.mjs';
import {collectProducts} from '../examples/node/multiple-product-urls.mjs';
const url='https://www.amazon.com/dp/B0CRY1MG68';
const completed={status:'completed',data:{source:{asin:'B0CRY1MG68',marketplace:'amazon.com',fetchedAt:'2026-11-01T00:00:00Z'},media:{productVideos:[],productImages:[],variantImages:[]},warnings:[]}};
test('video tutorial handles cached200 and queued202 with finite explicit polling',async()=>{
 const cached=[];assert.deepEqual(await extractVideos(async(...args)=>{cached.push(args);return{status:200,data:completed};},url,'same-operation'),completed);assert.equal(cached.length,1);assert.equal(cached[0][3],'same-operation');assert.equal(cached[0][2].include.creatorVideos,false);
 const job='11111111-1111-4111-8111-111111111111';const responses=[{status:202,data:{status:'queued',jobId:job}},{status:202,data:{status:'processing'}},{status:200,data:completed}];const calls=[];let waits=0;
 assert.deepEqual(await extractVideos(async(...args)=>{calls.push(args);return responses.shift();},url,'retry-id',{wait:async()=>{waits++;},maxPolls:2}),completed);assert.equal(waits,2);assert.equal(calls.length,3);assert.equal(calls[1][1],`/scrapes/${job}/result`);assert.equal(calls[1][3],undefined);
 let total=0;await assert.rejects(extractVideos(async()=>{total++;return{status:202,data:{status:'queued',jobId:job}};},url,'bounded',{wait:async()=>{},maxPolls:2}),/Polling limit/);assert.equal(total,3);
});
test('video conversion is explicit, uses a distinct stable operation ID, and reads top-levelurl',async()=>{
 const media={...completed,data:{...completed.data,media:{productVideos:[{src:'https://m.media-amazon.com/images/S/video/default.m3u8'}]}}};const calls=[];
 const request=async(...args)=>{calls.push(args);return{status:200,data:{url:'https://cdn.amzdownloader.com/video.mp4'}};};
 assert.equal(await selectDownload(request,media,'video-operation',false),null);assert.equal(calls.length,0);
 assert.deepEqual(await selectDownload(request,media,'video-operation',true),{url:'https://cdn.amzdownloader.com/video.mp4',converted:true});assert.equal(calls.length,1);assert.equal(calls[0][1],'/videos/convert');assert.equal(calls[0][3],'video-operation:mp4');
 const direct={...completed,data:{...completed.data,media:{productVideos:[{src:'https://m.media-amazon.com/example.mp4'}]}}};assert.equal((await selectDownload(request,direct,'direct',true)).converted,false);assert.equal(calls.length,1);
 const directory=await mkdtemp(path.join(os.tmpdir(),'amz-docs-video-'));
 try{const file=path.join(directory,'video.mp4');await downloadMp4('https://cdn.amzdownloader.com/video.mp4',file,async(_url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);return new Response('fixture');});assert.equal(await readFile(file,'utf8'),'fixture');}finally{await rm(directory,{recursive:true,force:true});}
});
test('multi-product tutorial iterates sequentially, checkpoints, preserves per-product keys, and bounds input',async()=>{
 const calls=[],checkpoints=[];let active=0,maxActive=0;const request=async(...args)=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();calls.push(args);active--;return{status:200,data:completed};};
 const urls=[url,'https://www.amazon.com/dp/B0F3GWXLTS'];const result=await collectProducts(request,urls,'stable-run',async state=>checkpoints.push(JSON.parse(JSON.stringify(state))));
 assert.equal(result.length,2);assert.equal(maxActive,1);assert.deepEqual(calls.map(c=>c[3]),['stable-run:1','stable-run:2']);assert.deepEqual(checkpoints.map(s=>s.results.length),[1,2]);assert.equal(calls.every(c=>c[1]==='/scrapes'),true);
 await assert.rejects(collectProducts(request,[url,url],'duplicate'),/duplicate/);await assert.rejects(collectProducts(request,Array.from({length:11},(_,i)=>url+i),'too-many'),/1 to 10/);
 let attempts=0;await assert.rejects(collectProducts(async()=>{attempts++;throw new Error('stop-on-error');},urls,'no-loop'),/stop-on-error/);assert.equal(attempts,1);
});
test('Python image tutorial handles200/202, keeps variant URLs, bounds polls, and rejects non-media downloads',()=>{
 const code=String.raw`import importlib.util, pathlib, sys, tempfile
sys.dont_write_bytecode=True
base=pathlib.Path('examples/python').resolve();sys.path.insert(0,str(base))
spec=importlib.util.spec_from_file_location('download_images',base/'download_images.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Fake:
 def __init__(self,responses):self.responses=list(responses);self.calls=[]
 def request(self,*args):self.calls.append(args);return self.responses.pop(0)
complete={'status':'completed','data':{'media':{'productImages':[],'variantImages':[]},'warnings':[]}}
fake=Fake([(200,complete)]);assert module.extract_images(fake,'https://www.amazon.com/dp/B0CRY1MG68','images-key')==complete;assert len(fake.calls)==1;assert fake.calls[0][2]['include']['productVideos'] is False
job='11111111-1111-4111-8111-111111111111';fake=Fake([(202,{'status':'queued','jobId':job}),(202,{'status':'processing'}),(200,complete)])
assert module.extract_images(fake,'https://www.amazon.com/dp/B0CRY1MG68','same-key',wait=lambda _:None,max_polls=2)==complete;assert len(fake.calls)==3;assert fake.calls[1][1].endswith('/result')
assert module.image_urls({'productImages':[{'src':'https://m.media-amazon.com/a.jpg'}],'variantImages':[{'images':[{'src':'https://m.media-amazon.com/a.jpg'},{'src':'https://m.media-amazon.com/b.jpg'}]}]})==['https://m.media-amazon.com/a.jpg','https://m.media-amazon.com/b.jpg']
with tempfile.TemporaryDirectory() as target:
 try:module.download_image('https://not-amazon.example/image.jpg',pathlib.Path(target),1)
 except ValueError:pass
 else:raise AssertionError('Untrusted image URL accepted')
fake=Fake([(202,{'status':'queued','jobId':job}),(202,{'status':'processing'})])
try:module.extract_images(fake,'https://www.amazon.com/dp/B0CRY1MG68','bounded',wait=lambda _:None,max_polls=1)
except RuntimeError as e:assert 'Polling limit' in str(e)
else:raise AssertionError('Unbounded polling')
assert len(fake.calls)==2
`;
 execFileSync('python3',['-c',code],{cwd:process.cwd(),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
});

test('every shell fence parses and dispatches continued commands without executing them',async()=>{
 const {readdirSync,readFileSync}=await import('node:fs');
 const walk=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.name.startsWith('.')||entry.name==='node_modules'?[]:entry.isDirectory()?walk(path.join(directory,entry.name)):entry.name.endsWith('.mdx')?[path.join(directory,entry.name)]:[]);
 const names=['git','cd','node','python3','codex','curl','mint'];
 const stubs=names.map(name=>`${name}() { printf '%s\\0' '${name}' "$@"; printf '\\n'; }`).join('\n');
 let fences=0,codexCommands=0;
 for(const file of walk('.'))for(const match of readFileSync(file,'utf8').matchAll(/```(?:bash|sh|shell)[^\n]*\n([\s\S]*?)```/g)){
  const code=match[1];fences++;
  for(const line of code.split('\n'))assert.ok((line.match(/\\+$/)?.[0].length??0)<=1,`${file}: doubled shell continuation`);
  execFileSync('/bin/bash',['--noprofile','--norc','-n'],{input:code,stdio:['pipe','pipe','pipe']});
  // PATH is empty: only shell builtins and these harmless capture functions run.
  const output=execFileSync('/bin/bash',['--noprofile','--norc','-eu','-c',stubs+'\n'+code],{encoding:'utf8',env:{PATH:'',AMZDOWNLOADER_API_KEY:'SYNTHETIC_OFFLINE_ONLY'},stdio:['ignore','pipe','pipe']});
  for(const line of output.trimEnd().split('\n').filter(Boolean)){
   const argv=line.split('\0');if(argv.at(-1)==='')argv.pop();
   assert.ok(names.includes(argv[0]),`${file}: unexpected command`);
   if(argv[0]==='codex'){
    codexCommands++;assert.deepEqual(argv,['codex','mcp','add','amzdownloader','--url','https://amzdownloader.com/mcp','--bearer-token-env-var','AMZDOWNLOADER_API_KEY']);
   }
   if(argv[0]==='node'&&argv[1]==='examples/node/download-videos.mjs')assert.ok(argv.length===4||argv.length===5,`${file}: split Node.js command`);
   if(argv[0]==='python3'&&argv[1]==='examples/python/download_images.py')assert.equal(argv.length,4,`${file}: split Python command`);
  }
 }
 assert.ok(fences>=10);assert.equal(codexCommands,1);
});
