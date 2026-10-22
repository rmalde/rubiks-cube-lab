import {readOpenRouterKey} from './credentials.mjs';
import {mkdirSync,writeFileSync,renameSync,readdirSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {MOVES,FACE_NAMES,scramble,applyMove,isSolved,matched,textState} from './cube.mjs';

export const DEFAULT_MODEL_KEYS=['astra','jev','luna'];
export const MODELS = [
  {key:'astra',name:'GPT-6 Astra',id:'openai/gpt-6-astra',kind:'chat'},
  {key:'jev',name:'Jev 1.13',id:'typesafe/jev-1.13',kind:'decision'},
  {key:'luna',name:'GPT-5.6 Luna',id:'openai/gpt-5.6-luna',kind:'chat'},
  {key:'sol',name:'GPT-5.6 Sol',id:'openai/gpt-5.6-sol',kind:'chat'},
];
export const RULES = `Solve a standard 3x3 Rubik's Cube. Select exactly ONE next face move from the 18 legal moves. The environment applies it and supplies the next state. Plan a complete solution and execute it one move at a time. A solved cube has nine identical facelets on each face. Do not optimize only the immediate number of matching stickers; a solution can require temporary regressions. Avoid repeated cycles.
Notation: U up, R right, F front, D down, L left, B back. A plain letter is 90 degrees clockwise when looking directly at that face from outside. A prime (') is 90 degrees counterclockwise; 2 is 180 degrees. Each selected move counts as one face turn, including half turns. Whole-cube rotations and slice moves are not available.
Colors are encoded by their solved face: U white, R red, F green, D yellow, L orange, B blue. Centers are fixed. Each face is listed row by row, left to right, as viewed from outside. The unfolded net is U above F, L F R B in the middle, D below F. U's bottom row touches F's top row; D's top row touches F's bottom row. B's right edge touches L's left edge. Orientation stays fixed throughout. No solver, shuffle sequence, or external tools are available. Return only the selected move classification.`;
export const CRITERIA=Object.fromEntries(MOVES.map(m=>[m,`Turn the ${FACE_NAMES[m[0]]} face ${m.endsWith('2')?'180 degrees':m.endsWith("'")?'90 degrees counterclockwise':'90 degrees clockwise'}, viewed from outside that face.`]));
export function makeObservation(state,moves,maxMoves) {
  return `${RULES}\n\nCurrent state (URFDLB): ${state}\n${textState(state)}\n\nMoves already applied by you: ${moves.join(' ')||'(none)'}\nMoves used: ${moves.length}. Move limit: ${maxMoves}.\nSelect the next move.`;
}
export function requestFor(model,observation) {
  if(model.kind==='decision')return {path:'/api/alpha/decisions',body:{model:model.id,state:observation,questions:{move:{type:'choice',instructions:'Which single legal face move should be applied next to solve this Rubik\'s Cube?',criteria:CRITERIA}}}};
  return {path:'/api/v1/chat/completions',body:{model:model.id,messages:[{role:'user',content:observation}],reasoning:{effort:'medium'},max_tokens:4096,response_format:{type:'json_schema',json_schema:{name:'cube_move',strict:true,schema:{type:'object',properties:{move:{type:'string',enum:MOVES}},required:['move'],additionalProperties:false}}}}};
}
export function improvedRequest(model, observation, state, history, maxMoves=500) {
  const applied=history.filter(h=>h.move);
  const visited=[history[0]?.before||state,...applied.map(h=>h.after)];
  const candidates=MOVES.map(move=>{const after=applyMove(state,move);return {move,state:after,solved:isSolved(after),matched:matched(after),visits:visited.filter(s=>s===after).length};});
  const context={rules:RULES.replace('Return only the selected move classification.','Return the required structured output.'),currentState:state,faces:textState(state),appliedMoves:applied.map(h=>h.move),movesUsed:applied.length,requestLimit:maxMoves,requestsUsed:history.length,requestsRemaining:Math.max(0,maxMoves-history.length),candidates};
  if(model.kind==='decision')return {path:'/api/alpha/decisions',body:{model:model.id,state:context,questions:{move:{type:'choice',instructions:'Select the next move toward a solved cube. If any candidate has solved=true, select that move. Avoid revisiting states when possible. Matching stickers alone is not a solution metric.',criteria:Object.fromEntries(candidates.map(c=>[c.move,`${CRITERIA[c.move]} Result: ${c.state}. Solved: ${c.solved}. Matching stickers: ${c.matched}/54. Prior visits: ${c.visits}.`]))}}}};
  if(model.compactInput)context.candidates=candidates.map(({move,solved,visits})=>({move,solved,visits}));
  const memory=history.filter(h=>h.classification?.plan).at(-1)?.classification.plan||'No plan yet.';
  return {path:'/api/v1/chat/completions',body:{model:model.id,messages:[{role:'user',content:JSON.stringify({...context,instructions:'Return the next move and a concise working plan. Keep the plan across turns. State your current stage, target pieces, and remaining moves if known. The previous move was already applied. Verify your plan against the current state. Choose an immediate solved candidate when available.',previousPlan:memory})}],reasoning:{effort:'medium'},max_tokens:16384,response_format:{type:'json_schema',json_schema:{name:'cube_move_plan',strict:true,schema:{type:'object',properties:{move:{type:'string',enum:MOVES},plan:{type:'string'}},required:['move','plan'],additionalProperties:false}}}}};
}
export function assistedRequest(model,state,plan) {
  const instructions='This is a solver-assisted control test. A separate two-phase solver computed and verified the supplied plan from the current cube state. Select exactly the first move in remainingPlan. Do not skip, invert, or change it. Return its move classification.';
  const context={instructions,currentState:state,remainingPlan:plan,nextMove:plan[0]};
  if(model.kind==='decision')return {path:'/api/alpha/decisions',body:{model:model.id,state:context,questions:{move:{type:'choice',instructions:'Which move is nextMove, the first entry of remainingPlan?',criteria:CRITERIA}}}};
  const request=requestFor(model,JSON.stringify(context));request.body.reasoning={effort:'low'};request.body.max_tokens=4096;return request;
}
export function parseClassification(model,data) {
  if(model.kind==='chat'&&data.choices?.[0]?.finish_reason==='length')throw new Error('Output token limit reached before a complete move classification.');
  const result=model.kind==='decision'?{move:data.answers?.move?.choice,confidence:data.answers?.move?.confidence,probabilities:data.answers?.move?.probabilities}:JSON.parse(data.choices?.[0]?.message?.content||'null');
  if(!result||!MOVES.includes(result.move))throw new Error('Model did not return a legal move classification.');
  return result;
}
export function recordInterruptedRequests(model,initialState) {
  const records=new Map(model.history.map(h=>[h.request,h]));let state=initialState,elapsedMs=0;
  const history=[];
  for(let request=1;request<=model.requests;request++){
    let entry=records.get(request);
    if(!entry){entry={request,error:'Interrupted request: no response was recorded and no move was applied. Cost is unknown.',before:state,after:state,latencyMs:0,elapsedMs,timingEstimated:true,usage:null};model.invalidResponses++;model.costKnown=false;}
    history.push(entry);state=entry.after;elapsedMs=entry.elapsedMs;
  }
  model.history=history;
}
export class Benchmarks {
  constructor(directory){this.directory=directory;mkdirSync(directory,{recursive:true});this.runs=new Map();this.controllers=new Map();this.key=null;
    for(const f of readdirSync(directory).filter(f=>f.endsWith('.json'))){try{const r=JSON.parse(readFileSync(`${directory}/${f}`,'utf8'));if(!r.id||!r.models)continue;if(r.status==='running'){r.status='interrupted';for(const m of r.models)if(m.status==='running'||m.status==='queued'){m.status='interrupted';m.pendingSince=null;}}this.runs.set(r.id,r);}catch{}}
  }
  getKey(){if(!this.key){const credential=readOpenRouterKey();this.key=credential.key;this.keySource=credential.source;}return this.key;}
  save(run){run.updatedAt=new Date().toISOString();const p=`${this.directory}/${run.id}.json`;writeFileSync(p+'.tmp',JSON.stringify(run,null,2));renameSync(p+'.tmp',p);}
  list(){return [...this.runs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  start({seed=20260918,scrambleLength=20,maxMoves=500,initialState=null,label=null,modelKeys=DEFAULT_MODEL_KEYS,protocol="original"}={}){
    if(this.list().some(r=>r.status==='running'))throw new Error('A comparison is already running.');
    if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('Invalid seed.');
    if(!Number.isInteger(maxMoves)||maxMoves<1||maxMoves>500)throw new Error('Move limit must be 1–500.');
    if(!Number.isInteger(scrambleLength)||scrambleLength<1||scrambleLength>30)throw new Error('Shuffle length must be 1–30.');
    if(!Array.isArray(modelKeys)||!modelKeys.length||new Set(modelKeys).size!==modelKeys.length||modelKeys.some(k=>!MODELS.some(m=>m.key===k)))throw new Error('Invalid model selection.');
    if(!['original','memory-candidates','solver-assisted'].includes(protocol))throw new Error('Invalid protocol.');
    this.getKey();const s=scramble(seed,scrambleLength);if(initialState)throw new Error('Custom states are not enabled.');
    const run={id:randomUUID(),createdAt:new Date().toISOString(),status:'running',label:label||'Shared shuffle',seed,scramble:s.moves,initialState:s.state,config:{credentialsSource:this.keySource,protocolVersion:protocol,maxMoves,maxRequests:maxMoves,perRequestTimeoutSeconds:120,perModelTimeLimitSeconds:Math.max(1800,maxMoves*60),perModelCostLimitUSD:15,reasoning:protocol==='solver-assisted'?'low':'medium',maxOutputTokens:protocol==='memory-candidates'?16384:4096,turnMetric:'HTM: every face move, including a half turn, counts as one turn',shuffleVisibleToModels:false,solverAssisted:protocol==='solver-assisted',protocol:protocol==='solver-assisted'?'SOLVER-ASSISTED: a two-phase solver supplies the plan; the model classifies each next move':protocol==='original'?'one move per request; current state + complete applied move history; no external solver':'one move per request; successor states from cube engine; written plan memory for chat models; no external solver'},prompt:protocol==='solver-assisted'?'Solver-assisted control. Each request contains a verified remaining plan.': RULES,criteria:CRITERIA,models:MODELS.filter(m=>modelKeys.includes(m.key)).map(m=>({...m,status:'queued',state:s.state,turns:0,quarterTurns:0,requests:0,invalidResponses:0,elapsedMs:0,apiMs:0,costUSD:0,costKnown:true,matched:matched(s.state),bestMatched:matched(s.state),history:[],pendingSince:null}))};
    this.runs.set(run.id,run);this.save(run);Promise.all(run.models.map(m=>this.execute(run,m))).then(()=>{run.status=run.models.some(m=>m.status==='stopped')?'stopped':'complete';run.finishedAt=new Date().toISOString();this.save(run);}).catch(()=>{run.status='error';this.save(run);});return run;
  }
  resume(source,{modelKeys=source.models.map(m=>m.key),maxOutputTokens=4096,compactInput=false}={}) {
    if(this.list().some(r=>r.status==='running'))throw new Error('A comparison is already running.');
    if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<256||maxOutputTokens>16384)throw new Error('Invalid output token limit.');
    const run=structuredClone(source);run.id=randomUUID();run.parentRunId=source.id;run.createdAt=new Date().toISOString();delete run.finishedAt;run.status='running';run.label=source.label+' · resumed';run.config.maxOutputTokens=maxOutputTokens;run.config.compactInput=compactInput;run.config.perModelTimeLimitSeconds=Math.max(1800,run.config.maxRequests*60);
    run.models=run.models.filter(m=>modelKeys.includes(m.key)&&!m.solved);
    if(!run.models.length)throw new Error('No unsolved models selected.');
    for(const m of run.models){recordInterruptedRequests(m,run.initialState);m.compactInput=compactInput;delete m.outputTokenLimit;m.resumeBaseline={requests:m.requests,turns:m.turns,costUSD:m.costUSD,elapsedMs:m.elapsedMs};m.status='queued';m.pendingSince=null;delete m.finishedAt;}
    this.getKey();run.config.credentialsSource=this.keySource;this.runs.set(run.id,run);this.save(run);
    Promise.all(run.models.map(m=>this.execute(run,m))).then(()=>{run.status=run.models.some(m=>m.status==='stopped')?'stopped':'complete';run.finishedAt=new Date().toISOString();this.save(run);}).catch(()=>{run.status='error';this.save(run);});return run;
  }
  async execute(run,model){const elapsedBase=model.elapsedMs||0,started=performance.now();model.activeElapsedBaseMs=elapsedBase;model.startedAt=new Date().toISOString();model.status='running';let consecutiveErrors=0;this.save(run);
    while(model.requests<run.config.maxRequests&&!isSolved(model.state)){
      if(model.status==='stopped')break;
      if(elapsedBase+performance.now()-started>run.config.perModelTimeLimitSeconds*1000){model.status='time_limit';break;}
      if(model.costUSD>=run.config.perModelCostLimitUSD){model.status='cost_limit';break;}
      const before=model.state,observation=makeObservation(before,model.history.filter(h=>h.move).map(h=>h.move),run.config.maxMoves);
      let assistance;
      if(run.config.protocolVersion==='solver-assisted'){const {solutionFor}=await import('./solver.mjs');const previous=model.history.filter(h=>h.assistance).at(-1);const remaining=previous&&previous.move===previous.assistance[0]?previous.assistance.slice(1):null;assistance=remaining?.length?remaining:solutionFor(before);}
      const request=assistance?assistedRequest(model,before,assistance):run.config.protocolVersion==='memory-candidates'?improvedRequest(model,observation,before,model.history,run.config.maxRequests):requestFor(model,observation),controller=new AbortController();if(model.kind==='chat')request.body.max_tokens=model.outputTokenLimit||run.config.maxOutputTokens;this.controllers.set(run.id+model.key,controller);
      const timeout=setTimeout(()=>controller.abort(),run.config.perRequestTimeoutSeconds*1000);const t=performance.now();model.requests++;model.pendingSince=Date.now();this.save(run);
      let response,httpStatus,retryWithLowerLimit=false;
      try{
        const res=await fetch('https://openrouter.ai'+request.path,{method:'POST',headers:{Authorization:'Bearer '+this.getKey(),'Content-Type':'application/json'},body:JSON.stringify(request.body),signal:controller.signal});
        httpStatus=res.status;response=await res.json();const latencyMs=performance.now()-t;model.apiMs+=latencyMs;
        if(!res.ok||response.error){if(res.status===402&&model.kind==='chat'){const affordable=Number(response.error?.message?.match(/afford ([\d,]+)/)?.[1]?.replaceAll(',',''));if(affordable>=512){model.outputTokenLimit=Math.max(256,Math.min(request.body.max_tokens-1,Math.floor(affordable*.75),4096));retryWithLowerLimit=true;}}throw new Error(`OpenRouter ${res.status}: ${response.error?.message||'Request failed'}`);};
        const usage=response.usage||{};if(typeof usage.cost==='number')model.costUSD+=usage.cost;else model.costKnown=false;
        if(model.status==='stopped')break;
        const classification=parseClassification(model,response),move=classification.move;
        model.state=applyMove(before,move);model.turns++;model.quarterTurns+=move.endsWith('2')?2:1;model.matched=matched(model.state);model.bestMatched=Math.max(model.bestMatched,model.matched);
        model.history.push({request:model.requests,move,classification,assistance,input:run.config.protocolVersion!=='original'?request.body:undefined,before,after:model.state,matched:model.matched,latencyMs,elapsedMs:elapsedBase+performance.now()-started,usage,resolvedModel:response.model,provider:response.provider||null,responseId:response.id||null});consecutiveErrors=0;
        model.resolvedModel=response.model;
      }catch(e){if(!response?.usage)model.costKnown=false;if(model.status==='stopped')break;consecutiveErrors++;model.invalidResponses++;model.history.push({request:model.requests,input:run.config.protocolVersion!=='original'?request.body:undefined,error:String(e.message).replaceAll(this.key,'[REDACTED]').slice(0,500),before,after:before,latencyMs:performance.now()-t,elapsedMs:elapsedBase+performance.now()-started,finishReason:response?.choices?.[0]?.finish_reason||null,content:response?.choices?.[0]?.message?.content||null,usage:response?.usage||null,responseId:response?.id||null});if(httpStatus===402&&!retryWithLowerLimit){model.status='credit_limit';break;}if(consecutiveErrors>=3){model.status='error';break;}}
      finally{if(model.status==='stopped'&&!model.history.some(h=>h.request===model.requests)){model.history.push({request:model.requests,error:'Stopped during request; no move was applied.',before,after:before,latencyMs:performance.now()-t,elapsedMs:elapsedBase+performance.now()-started,usage:response?.usage||null});model.invalidResponses++;if(!response?.usage)model.costKnown=false;}clearTimeout(timeout);this.controllers.delete(run.id+model.key);model.pendingSince=null;model.elapsedMs=elapsedBase+performance.now()-started;this.save(run);}
    }
    if(model.status==='running')model.status=isSolved(model.state)?'solved':'move_limit';model.solved=isSolved(model.state);model.elapsedMs=elapsedBase+performance.now()-started;model.finishedAt=new Date().toISOString();this.save(run);
  }
  stop(id){const run=this.runs.get(id);if(!run)throw new Error('Run not found.');if(run.status!=='running')return run;for(const m of run.models){if(m.status==='running'||m.status==='queued'){m.status='stopped';this.controllers.get(id+m.key)?.abort();}}this.save(run);return run;}
}
