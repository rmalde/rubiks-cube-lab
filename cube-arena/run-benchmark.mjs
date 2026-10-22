// A command-line runner for repeatable tests. Each run makes paid API requests.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Benchmarks} from './benchmark.mjs';
const options=process.argv[2]?JSON.parse(process.argv[2]):{};
const {resumeRunId,outputDirectory,...settings}=options;
const manager=new Benchmarks(outputDirectory?resolve(outputDirectory):new URL('./data/',import.meta.url).pathname);
if(resumeRunId&&!/^[0-9a-f-]{36}$/.test(resumeRunId))throw new Error('Invalid run ID.');
const run=resumeRunId?manager.resume(JSON.parse(readFileSync(new URL(`./data/${resumeRunId}.json`,import.meta.url))),settings):manager.start(settings);
console.log(JSON.stringify({id:run.id,config:run.config}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>manager.stop(run.id));
const timer=setInterval(()=>{
  console.log(JSON.stringify({id:run.id,status:run.status,models:run.models.map(({key,status,turns,requests,matched,costUSD})=>({key,status,turns,requests,matched,costUSD}))}));
  if(run.status!=='running')clearInterval(timer);
},10000);
