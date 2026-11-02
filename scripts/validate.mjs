import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
const config=JSON.parse(readFileSync('docs.json','utf8'));
const spec=JSON.parse(readFileSync('openapi.json','utf8'));
assert.equal(spec.servers[0].url,'https://amzdownloader.com/api/v1');
assert.ok(spec.components.securitySchemes);
let pageCount=0,endpointCount=0;
function visit(node){
 if(Array.isArray(node)){node.forEach(visit);return;}
 if(!node||typeof node!=='object')return;
 if(node.pages)for(const page of node.pages){
  const endpoint=page.match(/^(GET|POST) (.+)$/);
  if(endpoint){assert.ok(spec.paths[endpoint[2]]?.[endpoint[1].toLowerCase()],`Unknown endpoint ${page}`);endpointCount++;}
  else {assert.ok(existsSync(`${page}.mdx`),`Missing page ${page}`);pageCount++;}
 }
 for(const [key,value]of Object.entries(node))if(key!=='pages')visit(value);
}
visit(config.navigation);
assert.equal(endpointCount,9);
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&!e.name.startsWith('.')&&!['node_modules'].includes(e.name)?walk(`${dir}/${e.name}`):e.isFile()?[`${dir}/${e.name}`]:[]);}
const titles=new Set();
for(const file of walk('.').filter(f=>f.endsWith('.mdx'))){
 const body=readFileSync(file,'utf8');
 for(const key of ['title','description','keywords'])assert.match(body,new RegExp(`^${key}: `,'m'),`Missing ${key}: ${file}`);
 const title=JSON.parse(body.match(/^title: (.+)$/m)[1]);
 assert.ok(!titles.has(title),`Duplicate title ${title}`);titles.add(title);
 for(const match of body.matchAll(/(?:href="|\]\()\/(?!\/)([^"#)]+)(?:#[^" )]*)?["\)]/g)){
  const path=match[1];assert.ok(existsSync(path)||existsSync(`${path}.mdx`),`Broken local link ${path} in ${file}`);
 }
}
if(process.argv.includes('--live')){
 const response=await fetch('https://amzdownloader.com/api/v1/openapi.json',{redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),spec,'Live contract differs; review before refreshing');
}
console.log(`Validated ${pageCount} pages, ${endpointCount} endpoints, branding and internal links.`);
