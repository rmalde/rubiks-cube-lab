process.env.CUBE_ARENA_KEY_SOURCE='environment';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {solutionFor} from '../solver.mjs';
import {scramble,applyMoves,SOLVED} from '../cube.mjs';
import {assistedRequest,MODELS} from '../benchmark.mjs';
test('assisted plans solve state-only inputs and are disclosed to every model',()=>{
  for(const seed of [20260918,47,109]){
    const state=scramble(seed,20).state,plan=solutionFor(state);
    assert(plan.length>0);assert.equal(applyMoves(state,plan),SOLVED);
    for(const m of MODELS){const request=assistedRequest(m,state,plan);const input=m.kind==='decision'?request.body.state:JSON.parse(request.body.messages[0].content);assert.equal(input.nextMove,plan[0]);assert.deepEqual(input.remainingPlan,plan);assert.match(input.instructions,/solver-assisted/);}
  }
  assert.deepEqual(solutionFor(SOLVED),[]);
});
test('assisted execution applies a wrong model move and replans from its actual result',async()=>{
  const {Benchmarks}=await import('../benchmark.mjs');
  const {mkdtempSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const directory=mkdtempSync(tmpdir()+'/cube-assisted-');
  const originalFetch=globalThis.fetch,originalKey=process.env.OPENROUTER_API_KEY;
  let calls=0;process.env.OPENROUTER_API_KEY='test-key';
  try{
    globalThis.fetch=async(url,{body})=>{
      const request=JSON.parse(body),next=request.state.nextMove;
      const move=calls++===0?(next==='R'?'L':'R'):next;
      return {ok:true,status:200,json:async()=>({answers:{move:{choice:move}},usage:{cost:0}})};
    };
    const run=new Benchmarks(directory).start({scrambleLength:1,maxMoves:100,modelKeys:['jev'],protocol:'solver-assisted'});
    for(let n=0;n<500&&run.status==='running';n++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(run.status,'complete');const m=run.models[0];assert(m.solved);
    assert.notEqual(m.history[0].move,m.history[0].assistance[0]);
    assert.equal(m.history[1].input.state.currentState,m.history[0].after);
    for(const entry of m.history)assert.equal(applyMoves(entry.before,entry.assistance),SOLVED);
  }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;rmSync(directory,{recursive:true,force:true});}
});
