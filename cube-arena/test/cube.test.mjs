import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SOLVED,MOVES,FACES,applyMove,applyMoves,isSolved,scramble,inverse,stickerGeometry,moveRotation,matched,textState} from '../cube.mjs';
import {MODELS,makeObservation,requestFor,parseClassification} from '../benchmark.mjs';

test('each move and inverse restore every state; four quarter turns are identity',()=>{
  for(const initial of [SOLVED,scramble().state])for(const m of MOVES){assert.equal(applyMoves(initial,[m,inverse(m)]),initial);assert.equal(applyMoves(initial,[m,m,m,m]),initial);}
});
test('seeded 20-turn shuffle is valid, deterministic, and can be solved',()=>{
  const a=scramble();assert.deepEqual(a,scramble());assert.equal(a.moves.length,20);assert(!isSolved(a.state));assert.equal(a.state.length,54);
  for(const f of FACES)assert.equal([...a.state].filter(c=>c===f).length,9);
  assert(isSolved(applyMoves(a.state,a.moves.slice().reverse().map(inverse))));assert.equal(matched(SOLVED),54);
});
test('3D geometry and animation agree with all 18 engine moves',()=>{
  const round=v=>v.map(n=>Math.round(n));
  function rotate(v,axis,a){const [x,y,z]=v,c=Math.cos(a),s=Math.sin(a);return round(axis===0?[x,y*c-z*s,y*s+z*c]:axis===1?[x*c+z*s,y,-x*s+z*c]:[x*c-y*s,x*s+y*c,z]);}
  const geometry=Array.from({length:54},(_,i)=>stickerGeometry(i));
  const key=(p,n)=>[...p,...n].join(',');const lookup=new Map(geometry.map((g,i)=>[key(g.position,g.normal),i]));
  for(const state of [SOLVED,scramble(98).state])for(const m of MOVES){const rotation=moveRotation(m),out=Array(54);
    geometry.forEach((g,i)=>{let p=g.position,n=g.normal;if(p[rotation.axis]===rotation.layer){p=rotate(p,rotation.axis,rotation.angle);n=rotate(n,rotation.axis,rotation.angle);}out[lookup.get(key(p,n))]=state[i];});
    assert.equal(out.join(''),applyMove(state,m),m);
  }
});
test('long sequences preserve counts and invert correctly',()=>{
  for(let seed=1;seed<=30;seed++){const a=scramble(seed,100);assert.equal(applyMoves(a.state,a.moves.slice().reverse().map(inverse)),SOLVED);}
});
test('protocol hides shuffle, supplies orientation, and restricts all models to same moves',()=>{
  const s=scramble(),obs=makeObservation(s.state,[],60);assert(obs.includes(s.state));assert(obs.includes(textState(s.state)));assert(!obs.includes(s.moves.join(' ')));
  for(const m of MODELS){const r=requestFor(m,obs);assert.equal(r.body.model,m.id);if(m.kind==='chat'){assert.deepEqual(r.body.response_format.json_schema.schema.properties.move.enum,MOVES);assert.equal(parseClassification(m,{choices:[{message:{content:'{"move":"R2"}'}}]}).move,'R2');}else {assert.deepEqual(Object.keys(r.body.questions.move.criteria),MOVES);assert.equal(parseClassification(m,{answers:{move:{choice:'U'}}}).move,'U');}}
  assert.throws(()=>applyMove(SOLVED,'x'));assert.throws(()=>parseClassification(MODELS[0],{choices:[{message:{content:'{"move":"R U"}'}}]}));
});
