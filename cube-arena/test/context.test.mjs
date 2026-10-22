import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MODELS,improvedRequest,makeObservation} from '../benchmark.mjs';
import {scramble,applyMove,MOVES,isSolved} from '../cube.mjs';

test('full and compact contexts retain exact state, long history, orientation and plan',()=>{
  const initial=scramble();let state=initial.state;const history=[];
  for(let i=0;i<300;i++){const move=MOVES[i%18],before=state;state=applyMove(state,move);history.push({request:i+1,move,before,after:state,classification:{move,plan:'Continue the pending corner sequence.'}});}
  for(const definition of MODELS)for(const compactInput of [false,true]){
    const request=improvedRequest({...definition,compactInput},makeObservation(state,history.map(h=>h.move),500),state,history,500);
    const context=definition.kind==='decision'?request.body.state:JSON.parse(request.body.messages[0].content);
    assert.equal(context.currentState,state);assert.deepEqual(context.appliedMoves,history.map(h=>h.move));assert.equal(context.movesUsed,300);assert.equal(context.requestsRemaining,200);assert.equal(context.requestLimit,500);
    assert.match(context.rules,/row by row, left to right, as viewed from outside/);assert.match(context.rules,/Colors are encoded by their solved face/);assert.match(context.rules,/No solver, shuffle sequence/);assert(!JSON.stringify(context).includes(initial.moves.join(' ')));
    for(const candidate of context.candidates){const after=applyMove(state,candidate.move);assert.equal(candidate.solved,isSolved(after));if(candidate.state)assert.equal(candidate.state,after);}
    if(definition.kind==='chat')assert.equal(context.previousPlan,'Continue the pending corner sequence.');
  }
});

test('invalid outputs use requests without counting extra visits or applied moves',()=>{
  const initial=scramble().state,after=applyMove(initial,'U');
  const history=[{request:1,move:'U',before:initial,after,classification:{plan:'Retain this plan.'}},{request:2,before:after,after,error:'Invalid response'}];
  const request=improvedRequest(MODELS[0],makeObservation(after,['U'],300),after,history,300),context=JSON.parse(request.body.messages[0].content);
  assert.equal(context.requestsUsed,2);assert.equal(context.requestsRemaining,298);assert.equal(context.movesUsed,1);assert.equal(context.candidates.find(c=>c.move==="U'").visits,1);assert.equal(context.previousPlan,'Retain this plan.');
});
