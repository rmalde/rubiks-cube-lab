import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {applyMove,applyMoves,isSolved,matched,scramble,SOLVED} from './cube.mjs';

const dir=new URL('./data/',import.meta.url),rows=[];
for(const file of readdirSync(dir).filter(f=>f.endsWith('.json'))){const raw=readFileSync(new URL(file,dir),'utf8'),run=JSON.parse(raw);if(!run.models){if(run.label==='18 one-move successor-state controls'){assert.equal(run.results.length,18);for(const result of run.results){assert.equal(result.state,applyMove(SOLVED,result.shuffle));assert.equal(result.after,applyMove(result.state,result.classification.move));assert.equal(result.solved,isSolved(result.after));}}continue;}
  const s=scramble(run.seed,run.scramble.length);assert.deepEqual(s.moves,run.scramble);assert.equal(s.state,run.initialState);
  for(const m of run.models){let state=run.initialState,turns=0,qtm=0,lastElapsed=0;
    for(const h of m.history){assert.equal(h.before,state);if(h.assistance){assert.equal(run.config.solverAssisted,true);assert(isSolved(applyMoves(state,h.assistance)));}assert(h.elapsedMs>=lastElapsed);lastElapsed=h.elapsedMs;if(h.move){state=applyMove(state,h.move);turns++;qtm+=h.move.endsWith('2')?2:1;assert.equal(h.matched,matched(state));assert.equal(h.classification.move,h.move);}else assert(h.error);assert.equal(h.after,state);}
    assert.equal(m.state,state);assert.equal(m.turns,turns);assert.equal(m.quarterTurns,qtm);assert.equal(m.matched,matched(state));assert.equal(m.bestMatched,Math.max(matched(run.initialState),...m.history.filter(h=>h.move).map(h=>h.matched)));if(m.solved!==undefined)assert.equal(m.solved,isSolved(state));if(m.status==='solved')assert(isSolved(state));assert.equal(m.invalidResponses,m.history.filter(h=>h.error).length);
    if(run.status!=='running'&&m.status!=='stopped')assert.equal(m.requests,m.history.length);
    rows.push({run:run.id,protocol:run.config.protocolVersion||'original',solver_assisted:!!run.config.solverAssisted,model:m.name,resolved_model:m.resolvedModel||m.id,status:m.status,solved:isSolved(state),face_turns:m.turns,quarter_turns:m.quarterTurns,requests:m.requests,invalid_responses:m.invalidResponses,elapsed_seconds:Number((m.elapsedMs/1000).toFixed(3)),cost_usd:m.costUSD,matched:matched(state),best_matched:m.bestMatched,unique_states:new Set([run.initialState,...m.history.map(h=>h.after)]).size,source_sha256:createHash('sha256').update(raw).digest('hex')});
  }
}
console.table(rows.map(({model,status,solved,face_turns,requests,elapsed_seconds,matched})=>({model,status,solved,face_turns,requests,elapsed_seconds,matched})));
if(rows.length){const cols=Object.keys(rows[0]);writeFileSync(new URL('./results.csv',import.meta.url),cols.join(',')+'\n'+rows.map(r=>cols.map(c=>JSON.stringify(r[c])).join(',')).join('\n')+'\n');}
console.log(`Verified ${rows.length} model records by replaying every recorded move.`);
