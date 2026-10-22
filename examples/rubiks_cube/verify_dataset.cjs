const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{createHash}=require('crypto');
const {SOLVED,apply}=require('./runtime/engine.cjs');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'data/manifest.json'))),sets={};
let checked=0;
for(const split of ['train','test']){
 const raw=fs.readFileSync(path.join(__dirname,`data/${split}.jsonl`),'utf8');
 assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.files[split].sha256);
 const rows=raw.trim().split('\n').map(JSON.parse);assert.equal(rows.length,manifest.files[split].rows);sets[split]=new Set();
 const depths=new Map();
 for(const row of rows){assert.equal(row.split,split);assert(row.shuffle_length>=1&&row.shuffle_length<=20);assert.equal(row.shuffle.length,row.shuffle_length);assert.equal(apply(SOLVED,row.shuffle),row.state);assert.notEqual(row.state,SOLVED);assert.equal(apply(row.state,row.reference_solution),SOLVED);sets[split].add(row.state);depths.set(row.shuffle_length,(depths.get(row.shuffle_length)||0)+1);checked++;}
 assert.equal(depths.size,20);if(split==='train')assert([...depths.values()].every(n=>n===1000));else assert.equal(sets.test.size,rows.length);
}
assert(![...sets.test].some(s=>sets.train.has(s)));
console.log(JSON.stringify({verified_tasks:checked,unique_train_states:sets.train.size,unique_test_states:sets.test.size,overlap:0}));
