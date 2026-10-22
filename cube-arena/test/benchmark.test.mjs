process.env.CUBE_ARENA_KEY_SOURCE='environment';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Benchmarks,parseClassification,MODELS} from '../benchmark.mjs';
import {scramble,inverse,SOLVED} from '../cube.mjs';

async function finish(run){for(let n=0;n<200&&run.status==='running';n++)await new Promise(r=>setTimeout(r,5));assert.notEqual(run.status,'running');}
test('all adapters stop on a verified solve and save reproducible records',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cube-test-')),originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';
  const shuffle=scramble(13,1),move=inverse(shuffle.moves[0]),requests=[];
  try{
    globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push({url,body});return {ok:true,status:200,json:async()=>body.questions?{model:body.model,answers:{move:{choice:move}},usage:{cost:.001}}:{model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify({move})}}],usage:{cost:.002}}};};
    const manager=new Benchmarks(directory),run=manager.start({seed:13,scrambleLength:1,maxMoves:6});await finish(run);
    assert.equal(requests.length,3);for(const m of run.models){assert.equal(m.status,'solved');assert.equal(m.state,SOLVED);assert.equal(m.turns,1);assert.equal(m.requests,1);assert.equal(m.history[0].before,shuffle.state);assert(m.elapsedMs>=0);}
    const persisted=JSON.parse(readFileSync(path.join(directory,run.id+'.json')));assert.equal(persisted.status,'complete');assert.equal(new Benchmarks(directory).list()[0].models[0].solved,true);
    const observations=requests.map(r=>r.body.state||r.body.messages[0].content);assert.equal(new Set(observations).size,1);
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;rmSync(directory,{recursive:true,force:true});}
});
test('invalid classifications cannot change cube state or fabricate moves',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cube-errors-')),originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';
  try{
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({choices:[{finish_reason:'length',message:{content:''}}],usage:{cost:.001}})});
    const run=new Benchmarks(directory).start({maxMoves:6});await finish(run);
    for(const m of run.models){assert.equal(m.status,'error');assert.equal(m.turns,0);assert.equal(m.requests,3);assert.equal(m.invalidResponses,3);assert.equal(m.state,run.initialState);assert(m.history.every(h=>h.error&&!h.move));assert.equal(m.costUSD,.003);}
    assert.throws(()=>parseClassification(MODELS[0],{choices:[{finish_reason:'length',message:{content:''}}]}),/token limit/);
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;rmSync(directory,{recursive:true,force:true});}
});
test('stop aborts in-flight requests and duplicate starts are rejected',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cube-stop-')),originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';let aborted=0;
  try{globalThis.fetch=async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new Error('Aborted'));}));
    const manager=new Benchmarks(directory),run=manager.start();assert.equal(run.config.maxRequests,500);assert.equal(run.config.perModelTimeLimitSeconds,30000);assert.throws(()=>manager.start(),/already running/);manager.stop(run.id);await finish(run);assert.equal(aborted,3);assert.equal(run.status,'stopped');assert(run.models.every(m=>m.status==='stopped'&&m.turns===0&&!m.costKnown));
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;rmSync(directory,{recursive:true,force:true});}
});

test('500 requests, model selection, and plan memory are valid and explicit',async()=>{
  const {improvedRequest,makeObservation}=await import('../benchmark.mjs');
  const directory=mkdtempSync(path.join(tmpdir(),'cube-limits-')),originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';
  try{
    const manager=new Benchmarks(directory);
    assert.throws(()=>manager.start({maxMoves:501}),/1–500/);
    assert.throws(()=>manager.start({modelKeys:['unknown']}),/model selection/);
    assert.throws(()=>manager.start({protocol:'unknown'}),/protocol/);
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({answers:{move:{choice:'U2'}},usage:{cost:.001}})});
    const run=manager.start({maxMoves:500,scrambleLength:1,modelKeys:['jev'],protocol:'memory-candidates'});await finish(run);
    assert.equal(run.models.length,1);assert.equal(run.models[0].status,'solved');assert.equal(run.config.maxRequests,500);
    const input=run.models[0].history[0].input;
    assert.equal(input.state.candidates.find(c=>c.move==='U2').solved,true);
    const chat=improvedRequest(MODELS[0],makeObservation(run.initialState,[],500),run.initialState,[{classification:{plan:'Continue stage two.'}}]);
    assert.equal(JSON.parse(chat.body.messages[0].content).previousPlan,'Continue stage two.');assert.equal(chat.body.max_tokens,16384);
    assert(!JSON.stringify(input).includes('20260918'));
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;rmSync(directory,{recursive:true,force:true});}
});
test('credit reservation errors reduce output allowance without fabricating a move',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cube-credit-')),originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';let calls=0;
  try{
    globalThis.fetch=async(url,{body})=>{const request=JSON.parse(body);if(calls++===0)return {ok:false,status:402,json:async()=>({error:{message:'You can only afford 2048 tokens.'}})};assert.equal(request.max_tokens,1536);return {ok:true,status:200,json:async()=>({choices:[{message:{content:'{"move":"U2"}'}}],usage:{cost:0}})};};
    const run=new Benchmarks(directory).start({modelKeys:['astra'],scrambleLength:1,maxMoves:5,protocol:'memory-candidates'});await finish(run);const m=run.models[0];assert(m.solved);assert.equal(m.turns,1);assert.equal(m.requests,2);assert.equal(m.history[0].before,m.history[0].after);
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;rmSync(directory,{recursive:true,force:true});}
});
test('resume retains moves, plan, cost, and interrupted request counts',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cube-resume-')),originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';
  try{
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({answers:{move:{choice:'U2'}},usage:{cost:0}})});
    const manager=new Benchmarks(directory),source=manager.start({modelKeys:['jev'],scrambleLength:1,maxMoves:5});await finish(source);
    // Recreate a stopped request with no response, as found in older records.
    const copy=structuredClone(source),m=copy.models[0];m.state=copy.initialState;m.status='stopped';m.solved=false;m.turns=0;m.quarterTurns=0;m.matched=42;m.bestMatched=42;m.requests=1;m.history=[];m.elapsedMs=100;m.costKnown=false;
    const resumed=manager.resume(copy,{modelKeys:['jev']});await finish(resumed);assert(resumed.models[0].solved);assert.equal(resumed.models[0].requests,2);assert.equal(resumed.models[0].history.length,2);assert.equal(resumed.models[0].history[0].timingEstimated,true);assert(resumed.models[0].history[1].elapsedMs>=100);assert.equal(copy.models[0].history.length,0);
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;rmSync(directory,{recursive:true,force:true});}
});
test('Sol receives full context and stops after one insufficient-credit response',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cube-sol-')),originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';let calls=0;
  try{
    globalThis.fetch=async(url,{body})=>{calls++;const request=JSON.parse(body),context=JSON.parse(request.messages[0].content);assert.equal(request.model,'openai/gpt-5.6-sol');assert.equal(context.requestLimit,500);assert.equal(context.currentState,scramble().state);assert.deepEqual(context.appliedMoves,[]);assert.equal(context.previousPlan,'No plan yet.');assert.match(context.rules,/Orientation stays fixed/);return {ok:false,status:402,json:async()=>({error:{message:'Insufficient credits.'}})};};
    const run=new Benchmarks(directory).start({modelKeys:['sol'],protocol:'memory-candidates'});await finish(run);assert.equal(calls,1);assert.equal(run.models[0].status,'credit_limit');assert.equal(run.models[0].turns,0);assert.equal(run.models[0].state,run.initialState);
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;rmSync(directory,{recursive:true,force:true});}
});
