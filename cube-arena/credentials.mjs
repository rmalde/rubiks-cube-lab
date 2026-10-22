import {execFileSync} from 'node:child_process';
export function readOpenRouterKey({source=process.env.CUBE_ARENA_KEY_SOURCE||'environment',environment=process.env,readSecret=()=>execFileSync('gcloud',['secrets','versions','access','latest','--secret=OPENROUTER_API_KEY','--project='+environment.GOOGLE_CLOUD_PROJECT],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000})}={}) {
  if(!['secret-manager','environment'].includes(source))throw new Error('Invalid OpenRouter key source.');
  const key=(source==='environment'?environment.OPENROUTER_API_KEY:readSecret())?.trim();
  if(!key)throw new Error('OpenRouter key is not available from the selected source.');
  return {key,source};
}
