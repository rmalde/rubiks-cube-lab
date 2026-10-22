"""One model solution attempt, scored by exact cube simulation."""
import json
import argparse
import subprocess
from pathlib import Path

MOVES = [f+s for f in 'URFDLB' for s in ('','2',"'")]
PROMPT = """Solve this 3x3 Rubik's Cube from its current state. Submit a complete sequence of at most 60 face turns using submit_solution. Do not submit only prose.
Colors use their solved face names: U white, R red, F green, D yellow, L orange, B blue. Centers and orientation stay fixed. Each face is listed row by row, left to right, viewed from outside. The net is U above F, L F R B across the middle, D below F. U's bottom row touches F's top row; D's top row touches F's bottom row; B's right edge touches L's left edge.
A plain face letter turns 90 degrees clockwise as viewed from outside that face. A prime turns counterclockwise, and 2 means a half turn. Whole-cube rotations and slice moves are not available. A solution must leave nine matching facelets on every face. The cube was already shuffled before this task began. The shuffle sequence is not supplied.
Current state in URFDLB order: {state}
{faces}"""
TOOL = {'type':'function','function':{'name':'submit_solution','description':'Submit the full solution sequence.','parameters':{'type':'object','properties':{'moves':{'type':'array','items':{'type':'string','enum':MOVES},'maxItems':60}},'required':['moves'],'additionalProperties':False}}}

def prompt(state):
    faces='\n'.join(f'{f}: '+ ' / '.join(state[i*9+j:i*9+j+3] for j in (0,3,6)) for i,f in enumerate('URFDLB'))
    return PROMPT.format(state=state,faces=faces)

def submitted_moves(message):
    calls=message.get('tool_calls') or []
    if len(calls)!=1:return None
    fn=calls[0].get('function',{})
    if fn.get('name')!='submit_solution':return None
    try: moves=json.loads(fn['arguments'])['moves']
    except (KeyError,ValueError,TypeError):return None
    if not isinstance(moves,list) or len(moves)>60 or any(not isinstance(m,str) or m not in MOVES for m in moves):return None
    return moves

def grade(state,moves):
    if moves is None:return 0.0
    result=subprocess.run(['node',str(Path(__file__).with_name('engine.cjs'))],input=json.dumps({'state':state,'moves':moves}),text=True,capture_output=True,check=True,timeout=10)
    return float(json.loads(result.stdout).get('solved') is True)

def run_task(state):
    from trajectory import Client
    client=Client(max_retries=20)
    trajectory_id=client.trajectories.create().tid
    try:
        response=client.chat.completions.create(model='rubiks-cube',messages=[{'role':'user','content':prompt(state)}],extra_body={'tools':[TOOL]},max_tokens=8192,temperature=1.0,top_p=.95,extra_headers={'X-Trajectory-Id':trajectory_id})
        message=response.choices[0].message.model_dump()
        reward=grade(state,submitted_moves(message))
        client.trajectories.log_reward(trajectory_id,reward_id='cube-solved',name='reward_accuracy',value=reward)
    except Exception:
        try:
            client.trajectories.complete(trajectory_id,termination_reason='ERROR')
        except Exception:
            pass  # Preserve the original failure if error reporting also fails.
        raise
    completed=client.trajectories.complete(trajectory_id,termination_reason='ENV_DONE')
    if completed.status!='completed':raise RuntimeError('Trajectory completion failed')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--task-id',required=True)
    args=parser.parse_args()
    states=json.loads(Path(__file__).with_name('cube_states.json').read_text())
    run_task(states[args.task_id])

if __name__=='__main__':main()
