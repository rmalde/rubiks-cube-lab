import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readOpenRouterKey} from '../credentials.mjs';
test('Secret Manager wins over an inherited environment key',()=>{
  assert.deepEqual(readOpenRouterKey({source:'secret-manager',environment:{OPENROUTER_API_KEY:'stale-test-key'},readSecret:()=> ' correct-test-key\n'}),{key:'correct-test-key',source:'secret-manager'});
});
test('environment keys require explicit selection and no silent fallback occurs',()=>{
  assert.equal(readOpenRouterKey({source:'environment',environment:{OPENROUTER_API_KEY:'test-key'},readSecret:()=>{throw Error('unexpected');}}).key,'test-key');
  assert.throws(()=>readOpenRouterKey({source:'secret-manager',environment:{OPENROUTER_API_KEY:'stale'},readSecret:()=>{throw Error('unavailable');}}),/unavailable/);
  assert.throws(()=>readOpenRouterKey({source:'environment',environment:{}}),/not available/);
});
