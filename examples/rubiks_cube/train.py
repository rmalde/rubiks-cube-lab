"""Resume-safe baseline, Nemotron Lightning training, and checkpoint evaluation."""
import json
import time
from pathlib import Path
from datetime import datetime,timezone
from trajectory import Client as SDKClient, APIConnectionError, APITimeoutError

class Client(SDKClient):
    """Keep saved jobs under observation through temporary network outages."""
    def request(self,*args,**kwargs):
        for attempt in range(120):
            try:
                return super().request(*args,**kwargs)
            except (APIConnectionError,APITimeoutError):
                if attempt==119:raise
                print(json.dumps({'phase':'reconnecting','attempt':attempt+1}),flush=True)
                time.sleep(30)

ROOT=Path(__file__).parent
ART=ROOT/'artifacts'
MODEL='nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16'
TRAIN_OPTIONS={'num_steps':100,'train_batch_size':4,'samples_per_instance':8,
    'learning_rate':0.0001,'lr_warmup_steps':5,'lr_hold_steps':35,'min_lr_ratio':0.1,
    'disable_thinking':False,'max_output_tokens_per_step':8192,
    'max_turns_per_trajectory':1,'max_response_chars_per_tool_call':256,
    'execution_timeout_seconds':600}
EVAL_OPTIONS={'evaluation_max_samples':200,'evaluation_samples_per_task':1,'execution_timeout_seconds':600,'disable_thinking':False,
    'max_output_tokens_per_step':8192,'max_turns_per_trajectory':1,
    'max_response_chars_per_tool_call':256,'evaluation_max_active_rollouts':4}

def save(name,value):
    path=ART/name;temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.replace(path)

def log(value):print(json.dumps(value),flush=True)

def wait_eval(client,bench_id,eval_id,label):
    while True:
        progress=client.evals.runs.progress(eval_id)
        save(label+'-progress.json',progress.model_dump(mode='json'))
        log({'phase':label,'eval_id':eval_id,'status':progress.status,'finished':progress.terminal_rollouts,'total':progress.total_rollouts})
        if progress.status=='completed':
            result=client.evals.runs.retrieve(eval_id)
            save(label+'-result.json',result.model_dump(mode='json'))
            stats=client.evals.runs.retrieve_rollout_statistics(eval_id)
            save(label+'-statistics.json',stats.model_dump(mode='json'))
            if result.reward_mean is None:raise RuntimeError('Evaluation has no measured reward')
            rewards=client.evals.rewards.list_trajectory_rewards(eval_id)
            save(label+'-trajectory-rewards.json',rewards.model_dump(mode='json'))
            recorded=[r for r in rewards.trajectory_rewards if r.trajectory_id]
            if not recorded:raise RuntimeError('Evaluation has no recorded trajectories')
            # Check examples from both ends of the reward range before training.
            ordered=sorted(recorded,key=lambda r:r.reward)
            sample={r.trajectory_id:r for r in ordered[:5]+ordered[-5:]}
            audit=[]
            for trajectory_id in sample:
                trajectory=client.trajectories.retrieve(trajectory_id,include_steps=False)
                audit.append(trajectory.model_dump(mode='json'))
            save(label+'-runtime-audit.json',audit)
            if any(t.get('error') or (t.get('rollout') or {}).get('harness_diagnostic') for t in audit):
                raise RuntimeError('Evaluation runtime errors require inspection before continuing')
            return result.reward_mean
        if progress.status in ('failed','cancelled'):raise RuntimeError(f'{label} ended with {progress.status}: {progress.failure}')
        time.sleep(30)

def main():
    ART.mkdir(exist_ok=True);client=Client(max_retries=20)
    bench_id=json.loads((ART/'benchmark.json').read_text())['bench_id']
    path=ART/'experiment.json'
    experiment=json.loads(path.read_text()) if path.exists() else {'bench_id':bench_id,'model':MODEL,'training_options':TRAIN_OPTIONS,'eval_options':EVAL_OPTIONS,'created_at':datetime.now(timezone.utc).isoformat()}
    if experiment['bench_id']!=bench_id:raise RuntimeError('Experiment belongs to another benchmark')
    save('experiment.json',experiment)
    if 'smoke_eval_run_id' not in experiment:
        run=client.evals.create(bench_id=bench_id,base_model_slug=MODEL,display_name='Rubiks Cube · updated runtime check',options={**EVAL_OPTIONS,'evaluation_max_samples':8,'evaluation_max_active_rollouts':4},idempotency_key=f'{bench_id}-cube-smoke-v2')
        experiment['smoke_eval_run_id']=run.eval_run_id;save('experiment.json',experiment)
    wait_eval(client,bench_id,experiment['smoke_eval_run_id'],'smoke')
    if 'training_run_id' not in experiment:
        run=client.training.create(bench_id=bench_id,base_model_slug=MODEL,options=TRAIN_OPTIONS,idempotency_key=f'{bench_id}-cube-training-v1')
        experiment['training_run_id']=run.training_run_id;save('experiment.json',experiment)
        log({'training_run_id':run.training_run_id})
    while True:
        run=client.training.runs.retrieve(experiment['training_run_id'])
        progress=client.training.runs.progress(experiment['training_run_id'])
        save('training-run.json',run.model_dump(mode='json'));save('training-progress.json',progress.model_dump(mode='json'))
        log({'phase':'training','status':run.status,'completed_steps':progress.completed_steps,'total_steps':progress.total_steps})
        if run.status=='succeeded':break
        if run.status in ('failed','cancelled'):raise RuntimeError(f'Training ended with {run.status}: {run.failure}')
        time.sleep(30)
    if 'baseline_eval_run_id' not in experiment:
        run=client.evals.create(bench_id=bench_id,base_model_slug=MODEL,display_name='Rubiks Cube · Lightning baseline',options=EVAL_OPTIONS,idempotency_key=f'{bench_id}-cube-baseline-v1')
        experiment['baseline_eval_run_id']=run.eval_run_id;save('experiment.json',experiment)
    baseline=wait_eval(client,bench_id,experiment['baseline_eval_run_id'],'baseline')
    checkpoint=client.training.checkpoints.retrieve(experiment['training_run_id'],TRAIN_OPTIONS['num_steps'])
    experiment['checkpoint_id']=checkpoint.checkpoint_id;save('experiment.json',experiment)
    if 'final_eval_run_id' not in experiment:
        run=client.evals.create(bench_id=bench_id,base_model_slug=MODEL,parent_checkpoint_id=checkpoint.checkpoint_id,display_name='Rubiks Cube · Lightning step 100',options=EVAL_OPTIONS,idempotency_key=f'{bench_id}-cube-final-v1')
        experiment['final_eval_run_id']=run.eval_run_id;save('experiment.json',experiment)
    final=wait_eval(client,bench_id,experiment['final_eval_run_id'],'final')
    result={'baseline_reward':baseline,'final_reward':final,'reward_delta':final-baseline,**experiment,'completed_at':datetime.now(timezone.utc).isoformat()}
    save('results.json',result);log(result)

if __name__=='__main__':main()
