"""Upload synthetic cube tasks; keep shuffle and solution out of the runtime."""
import json
from pathlib import Path
from trajectory import Client, BenchmarkSpec, TaskSpec
from trajectory.lib import DockerfileBuild,start_push,wait_for_benchmark_images
from trajectory.lib.benchmark_operations import BenchmarkOperation
ROOT=Path(__file__).parent

def build_benchmark():
    tasks=[];states={}
    for split in ('train','test'):
        for line in (ROOT/'data'/f'{split}.jsonl').read_text().splitlines():
            row=json.loads(line)
            states[row['id']]=row['state']
            tasks.append(TaskSpec(name=f"rubiks-cube/{row['id']}",split=split,run_command=f"python -u /opt/rubiks_cube/cube_harness.py --task-id {row['id']}",tags=[f"shuffle-{row['shuffle_length']:02}"]))
    (ROOT/'runtime/cube_states.json').write_text(json.dumps(states))
    return BenchmarkSpec(name='Rubiks Cube 1-20 - Nemotron Lightning - 20261001',family='rubiks-cube',description='20,000 balanced training tasks; distinct held-out states. Exact solve reward; shuffle and reference solution withheld.',runtime=DockerfileBuild('runtime/Dockerfile'),tasks=tasks)

def main():
    client=Client(max_retries=20);artifacts=ROOT/'artifacts';artifacts.mkdir(exist_ok=True)
    saved=artifacts/'ingestion.json'
    if saved.exists():
        operation=BenchmarkOperation(client,json.loads(saved.read_text())['operation_id'])
    else:
        agent_id=json.loads((artifacts/'agent.json').read_text())['agent_id']
        agent=client.agents.retrieve(agent_id)
        operation=start_push(client,build_benchmark(),agent_id=agent.agent_id,root=ROOT)
        saved.write_text(json.dumps({'operation_id':operation.id},indent=2)+'\n')
    print(f'operation_id={operation.id}',flush=True)
    result=operation.result(timeout=3600,poll_interval=20)
    (artifacts/'benchmark.json').write_text(json.dumps({'bench_id':result.status.bench_id},indent=2)+'\n')
    print(f'bench_id={result.status.bench_id}',flush=True)
    wait_for_benchmark_images(client,result.status.bench_id,timeout_seconds=2700)
    print('Runtime image ready',flush=True)

if __name__=='__main__':main()
