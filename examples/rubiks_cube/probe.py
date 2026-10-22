"""Check the exact runtime on eight held-out states while bulk upload runs."""
import json
from trajectory import Client
from trajectory.lib import start_push,wait_for_benchmark_images
from trajectory.lib.benchmark_operations import BenchmarkOperation
from ingest import ROOT,build_benchmark
from train import ART,MODEL,EVAL_OPTIONS,save,wait_eval

def main():
    client=Client(max_retries=12)
    path=ART/'probe.json'
    state=json.loads(path.read_text()) if path.exists() else {}
    if 'operation_id' not in state:
        benchmark=build_benchmark()
        selected=[];depths={1,2,3,4,5,10,15,20}
        for task in benchmark.tasks:
            depth=int(task.tags[0].split('-')[1])
            if task.split=='test' and depth in depths:
                selected.append(task);depths.remove(depth)
        benchmark.tasks=[t for t in benchmark.tasks if t.split=='train'][:8]+selected
        benchmark.name='Rubiks Cube runtime check 20261001'
        agent_id=json.loads((ART/'agent.json').read_text())['agent_id']
        operation=start_push(client,benchmark,agent_id=agent_id,root=ROOT)
        state['operation_id']=operation.id;save('probe.json',state)
    result=BenchmarkOperation(client,state['operation_id']).result(timeout=1800,poll_interval=10)
    state['bench_id']=result.status.bench_id;save('probe.json',state)
    wait_for_benchmark_images(client,state['bench_id'],timeout_seconds=1800)
    if 'eval_run_id' not in state:
        run=client.evals.create(bench_id=state['bench_id'],base_model_slug=MODEL,display_name='Updated cube runtime check',options={**EVAL_OPTIONS,'evaluation_max_samples':8,'evaluation_max_active_rollouts':4},idempotency_key=f"{state['bench_id']}-probe-v2")
        state['eval_run_id']=run.eval_run_id;save('probe.json',state)
    state['reward']=wait_eval(client,state['bench_id'],state['eval_run_id'],'probe')
    state['verified']=True;save('probe.json',state)

if __name__=='__main__':main()
