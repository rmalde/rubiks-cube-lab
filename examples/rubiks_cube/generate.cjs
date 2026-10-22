const {readFileSync, writeFileSync, mkdirSync} = require('fs');
const {createHash} = require('crypto');
const path = require('path');
const {MOVES, SOLVED, apply} = require('./runtime/engine.cjs');
const seed = 20260922;
let randomState = seed;
function random() {randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296;}
const axis = {U:0,D:0,R:1,L:1,F:2,B:2};
const hash = value => createHash('sha256').update(value).digest('hex');
const splitOf = state => parseInt(hash(`${seed}:${state}`).slice(0,8),16) % 5 === 0 ? 'test' : 'train';
const inverse = moves => [...moves].reverse().map(m => m.endsWith('2') ? m : m.endsWith("'") ? m[0] : m+"'");
const seen = new Set([SOLVED]), output = {train:[],test:[]}, counts = [];
function candidate(length) {
  const moves=[];
  while(moves.length<length) {const move=MOVES[Math.floor(random()*MOVES.length)]; if(!moves.length||axis[move[0]]!==axis[moves.at(-1)[0]])moves.push(move);}
  return moves;
}
for(let depth=1;depth<=20;depth++) {
  const bucket={train:[],test:[]};
  function accept(moves) {
    const state=apply(SOLVED,moves);if(seen.has(state))return;
    const split=splitOf(state);if(depth>2&&bucket[split].length >= (split==='train'?1000:100))return;
    const solution=inverse(moves);if(apply(state,solution)!==SOLVED)throw Error('Bad inverse');
    seen.add(state);bucket[split].push({state,shuffle:moves,reference_solution:solution,shuffle_length:depth,split,state_sha256:hash(state)});
  }
  if(depth===1)MOVES.forEach(m=>accept([m]));
  else if(depth===2){for(const a of MOVES)for(const b of MOVES)if(axis[a[0]]!==axis[b[0]])accept([a,b]);}
  else {let tries=0;while(bucket.train.length<1000||bucket.test.length<100){if(++tries>1000000)throw Error(`Sampling exhausted at ${depth}: train=${bucket.train.length}, test=${bucket.test.length}`);accept(candidate(depth));}}
  if(!bucket.train.length||!bucket.test.length)throw Error('Empty split');
  for(let i=0;i<1000;i++)output.train.push({...bucket.train[i%bucket.train.length],id:`train-d${String(depth).padStart(2,'0')}-${String(i).padStart(4,'0')}`,repeated_shallow_state:i>=bucket.train.length});
  bucket.test.forEach((row,i)=>output.test.push({...row,id:`test-d${String(depth).padStart(2,'0')}-${String(i).padStart(4,'0')}`,repeated_shallow_state:false}));
  counts.push({shuffle_length:depth,train_tasks:1000,unique_train_states:bucket.train.length,test_tasks:bucket.test.length});
}
// Mix training difficulty. Round-robin test depths so capped evaluations span 1–20.
for(let i=output.train.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[output.train[i],output.train[j]]=[output.train[j],output.train[i]];}
const groups=Array.from({length:20},(_,i)=>output.test.filter(r=>r.shuffle_length===i+1));
output.test=[];for(let i=0;groups.some(g=>g[i]);i++)for(const g of groups)if(g[i])output.test.push(g[i]);
const trainStates=new Set(output.train.map(r=>r.state));if(output.test.some(r=>trainStates.has(r.state)))throw Error('Split leak');
const directory=path.join(__dirname,'data');mkdirSync(directory,{recursive:true});
const files={};for(const split of ['train','test']){const text=output[split].map(r=>JSON.stringify(r)).join('\n')+'\n';writeFileSync(path.join(directory,`${split}.jsonl`),text);files[split]={rows:output[split].length,sha256:hash(text)};}
const manifest={seed,created_at:new Date().toISOString(),files,counts,unique_train_states:trainStates.size,unique_test_states:new Set(output.test.map(r=>r.state)).size,split_state_overlap:0,notes:['Shuffle length is not optimal solution distance.','Shallow training states repeat to balance shuffle lengths. Test states are unique.','Reference solutions are validated inverse shuffles and are never sent to the model.','Reward is exact solved-state verification; no sticker-match proxy.']};
writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest,null,2));
