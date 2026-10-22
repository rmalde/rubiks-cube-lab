import importlib.util
import json
import sys
from pathlib import Path
ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT/'runtime'))
from cube_harness import MOVES,grade,prompt,submitted_moves

def submission(moves):
    return {'tool_calls':[{'function':{'name':'submit_solution','arguments':json.dumps({'moves':moves})}}]}

def test_all_single_face_controls():
    rows=[json.loads(l) for split in ('train','test') for l in (ROOT/'data'/f'{split}.jsonl').read_text().splitlines()]
    controls={r['state']:r for r in rows if r['shuffle_length']==1}
    assert len(controls)==18
    for row in controls.values():
        assert grade(row['state'],row['reference_solution'])==1
        assert grade(row['state'],[])==0

def test_strict_action_validation():
    for moves in (['X'],['R']*61,'R U',None,[5]):assert submitted_moves(submission(moves)) is None
    assert submitted_moves(submission(['R',"U'",'F2']))==['R',"U'",'F2']
    assert submitted_moves({'content':'The cube is solved.'}) is None
    message=submission(['R']);message['tool_calls']*=2
    assert submitted_moves(message) is None

def test_sdk_071_typed_tool_call_is_accepted():
    from trajectory.types.inference.chat_completion_response import ChatCompletionResponseMessage
    message=ChatCompletionResponseMessage.model_validate({'role':'assistant','content':None,'tool_calls':[{'id':'call-1','type':'function','function':{'name':'submit_solution','arguments':json.dumps({'moves':['R',"U'"]})}}]})
    assert submitted_moves(message.model_dump())==['R',"U'"]

def test_nonmatching_solution_is_not_rewarded():
    row=json.loads((ROOT/'data/test.jsonl').read_text().splitlines()[-1])
    assert grade(row['state'],row['reference_solution'])==1
    assert grade(row['state'],['U'])==0
    assert grade(row['state'],None)==0

def test_upload_does_not_include_answers():
    spec=importlib.util.spec_from_file_location('cube_ingest',ROOT/'ingest.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    benchmark=module.build_benchmark()
    assert len(benchmark.tasks)==21857
    states=json.loads((ROOT/'runtime/cube_states.json').read_text())
    assert len(states)==21857
    for task in benchmark.tasks:
        assert not task.env_vars
        state=states[task.run_command.split('--task-id ')[1]]
        assert isinstance(state,str) and len(state)==54 and set(state)<=set('URFDLB')
    text=prompt(next(iter(states.values())))
    assert 'shuffle sequence is not supplied' in text
    assert 'Current state in URFDLB order' in text

def test_trajectory_id_covers_inference_reward_and_completion(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock
    import trajectory
    import cube_harness
    client=Mock()
    client.trajectories.create.return_value=SimpleNamespace(tid='test-trajectory')
    client.trajectories.complete.return_value=SimpleNamespace(status='completed')
    message=Mock();message.model_dump.return_value=submission([])
    client.chat.completions.create.return_value=SimpleNamespace(choices=[SimpleNamespace(message=message)])
    monkeypatch.setattr(trajectory,'Client',lambda **kwargs:client)
    monkeypatch.setenv('CUBE_STATE',''.join(f*9 for f in 'URFDLB'))
    cube_harness.run_task(''.join(f*9 for f in 'URFDLB'))
    assert client.chat.completions.create.call_args.kwargs['extra_headers']=={'X-Trajectory-Id':'test-trajectory'}
    client.trajectories.log_reward.assert_called_once_with('test-trajectory',reward_id='cube-solved',name='reward_accuracy',value=1.0)
    client.trajectories.complete.assert_called_once_with('test-trajectory',termination_reason='ENV_DONE')

def test_inference_failure_completes_same_trajectory_as_error(monkeypatch):
    import pytest,trajectory,cube_harness
    from types import SimpleNamespace
    from unittest.mock import Mock
    client=Mock();client.trajectories.create.return_value=SimpleNamespace(tid='failed-trajectory')
    client.chat.completions.create.side_effect=RuntimeError('inference failed')
    monkeypatch.setattr(trajectory,'Client',lambda **kwargs:client)
    monkeypatch.setenv('CUBE_STATE',''.join(f*9 for f in 'URFDLB'))
    with pytest.raises(RuntimeError,match='inference failed'):cube_harness.run_task(''.join(f*9 for f in 'URFDLB'))
    client.trajectories.log_reward.assert_not_called()
    client.trajectories.complete.assert_called_once_with('failed-trajectory',termination_reason='ERROR')
