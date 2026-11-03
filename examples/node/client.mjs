import {randomUUID} from 'node:crypto';
export const API_BASE='https://amzdownloader.com/api/v1';
const jobIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function jobPath(jobId,suffix=''){
 if(!jobIdPattern.test(jobId)||!['','/result'].includes(suffix))throw new Error('Invalid job ID');
 return `/scrapes/${jobId}${suffix}`;
}
export function mediaPath(asin,marketplace='amazon.com'){
 if(!/^[A-Za-z0-9]{10}$/.test(asin))throw new Error('ASIN must contain 10 letters or digits');
 return `/products/${asin.toUpperCase()}/media?${new URLSearchParams({marketplace})}`;
}
export class ApiError extends Error{
 constructor(status,code,retryAfter){super(`AmzDownloader HTTP ${status} (${code})${retryAfter?`; retry after ${retryAfter} seconds`:''}`);this.status=status;this.code=code;this.retryAfter=retryAfter;}
}
function allowedPath(path){
 const url=new URL(path,API_BASE+'/');
 if(!path.startsWith('/')||path.startsWith('//')||url.origin!=='https://amzdownloader.com'||url.hash)return false;
 return /^\/(?:usage|health|capabilities|openapi\.json|scrapes(?:\/[0-9a-f-]{36}(?:\/result)?)?|products\/[A-Z0-9]{10}\/media|videos\/convert)$/.test(url.pathname);
}
export function createClient({key=process.env.AMZDOWNLOADER_API_KEY,fetcher=globalThis.fetch}={}){
 if(typeof key!=='string'||!key.trim()||/[\r\n]/.test(key))throw new Error('Set AMZDOWNLOADER_API_KEY in your environment');
 return async function request(method,path,body, idempotencyKey){
  if(!allowedPath(path)||!['GET','POST'].includes(method))throw new Error('Unsupported API request path or method');
  if(idempotencyKey&&!/^[!-~]{1,128}$/.test(idempotencyKey))throw new Error('Invalid idempotency key');
  const headers={Authorization:`Bearer ${key}`,'Accept':'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
  const response=await fetcher(API_BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(60000)});
  let data;
  try{data=await response.json();}catch{throw new ApiError(response.status,'invalid_json_response');}
  if(!response.ok){
   const raw=data?.error?.code;
   const code=typeof raw==='string'&&/^[a-z0-9_]{1,80}$/i.test(raw)?raw:'request_failed';
   const retryValue=response.headers.get('retry-after');
   const retryAfter=/^\d{1,5}$/.test(retryValue??'')?Number(retryValue):undefined;
   throw new ApiError(response.status,code,retryAfter);
  }
  return {status:response.status,data,retryAfter:response.headers.get('retry-after')};
 };
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function extract(request,url,{idempotencyKey=randomUUID(),maxPolls=20,wait=pause}={}){
 if(!Number.isInteger(maxPolls)||maxPolls<1||maxPolls>100)throw new Error('Use a finite polling budget between 1 and 100');
 const created=await request('POST','/scrapes',{url,renderMode:'auto'},idempotencyKey);
 if(created.status===200&&created.data.status==='completed')return created.data;
 if(created.status!==202||!created.data.jobId)throw new Error('Unexpected extraction response');
 const jobId=created.data.jobId;
 const path=jobPath(jobId);
 for(let poll=0;poll<maxPolls;poll++){
  await wait(3000);
  const job=await request('GET',path);
  if(job.data.status==='completed')return (await request('GET',jobPath(jobId,'/result'))).data;
  if(['failed','expired'].includes(job.data.status))throw new Error(`Extraction ${job.data.status}; job ${jobId}`);
  if(!['queued','processing'].includes(job.data.status))throw new Error(`Unexpected job status; job ${jobId}`);
 }
 throw new Error(`Polling budget exhausted; job ${jobId} may still be running. Check it later without submitting another extraction.`);
}
