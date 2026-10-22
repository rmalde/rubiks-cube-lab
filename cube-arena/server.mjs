import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Benchmarks,MODELS} from './benchmark.mjs';
import {scramble} from './cube.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const bench=new Benchmarks(path.join(root,'data'));
const port=Number(process.env.PORT||4317);
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>10000)throw new Error('Request too large.');}return JSON.parse(s||'{}');}
const server=http.createServer(async(req,res)=>{try{
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){json(res,{error:'Local requests only.'},403);return;}
  const url=new URL(req.url,'http://localhost');
  if(req.method==='POST'&&req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin)){json(res,{error:'Origin not allowed.'},403);return;}
  if(url.pathname==='/api/state'&&req.method==='GET'){json(res,{models:MODELS,runs:bench.list().map(run=>({...run,models:run.models.map(model=>({...model,history:model.history.map(({input,...entry})=>entry)}))})),defaultScramble:scramble()});return;}
  if(url.pathname==='/api/benchmark'&&req.method==='POST'){const options=await body(req);json(res,bench.start(options),202);return;}
  if(url.pathname==='/api/resume'&&req.method==='POST'){const {id,...options}=await body(req);const source=bench.runs.get(id);if(!source)throw new Error('Run not found.');json(res,bench.resume(source,options),202);return;}
  if(url.pathname==='/api/stop'&&req.method==='POST'){const data=await body(req);json(res,bench.stop(data.id));return;}
  if(url.pathname.startsWith('/api/runs/')&&req.method==='GET'){const run=bench.runs.get(url.pathname.split('/').at(-1));json(res,run||{error:'Run not found.'},run?200:404);return;}
  if(req.method!=='GET'){json(res,{error:'Method not allowed.'},405);return;}
  const file=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const full=path.resolve(root,'public',file);
  if(!full.startsWith(path.join(root,'public')+path.sep)){json(res,{error:'Not found.'},404);return;}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  await stat(full);res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(await readFile(full));
}catch(e){json(res,{error:e.code==='ENOENT'?'Not found.':e.message.includes('gcloud')?'Cannot read the API key. Run gcloud auth login and try again.':e.message},e.code==='ENOENT'?404:400);}});
server.listen(port,'127.0.0.1',()=>console.log(`Cube Arena: http://127.0.0.1:${port}`));

for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  for(const run of bench.list())if(run.status==='running')bench.stop(run.id);
  server.close();
  const timer=setInterval(()=>{if(!bench.list().some(run=>run.status==='running')){clearInterval(timer);process.exit(0);}},100);
});
