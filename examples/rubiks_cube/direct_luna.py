"""Evaluate GPT-6 Luna through OpenRouter; no Trajectory calls or SDK."""
import concurrent.futures
import hashlib
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / 'runtime'))
from cube_harness import TOOL, grade, prompt, submitted_moves

MODEL = 'openai/gpt-6-luna'
OUT = ROOT / 'artifacts/direct-luna'


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def summarize(rows):
    records = [json.loads((OUT / f"{r['id']}.json").read_text())
               for r in rows if (OUT / f"{r['id']}.json").exists()]
    solved = sum(r.get('reward', 0) for r in records)
    errors = sum(r['status'] == 'api_error' for r in records)
    costs = [r.get('usage', {}).get('cost') for r in records]
    depths = {}
    for depth in range(1, 21):
        subset = [r for r in records if r['shuffle_length'] == depth]
        depths[str(depth)] = {'completed': len(subset),
                             'solved': sum(r.get('reward', 0) for r in subset)}
    result = {'model': MODEL, 'provider': 'OpenRouter', 'planned': len(rows),
              'completed': len(records), 'solved': solved, 'api_errors': errors,
              'score': solved / len(records) if records else None,
              'complete': len(records) == len(rows),
              'reported_cost_usd': sum(c for c in costs if c is not None),
              'records_without_cost': sum(c is None for c in costs),
              'statuses': dict(Counter(r['status'] for r in records)),
              'by_shuffle_length': depths}
    save(OUT / 'results.json', result)
    print(json.dumps({k: result[k] for k in ('completed', 'planned', 'solved', 'api_errors', 'reported_cost_usd')}), flush=True)
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = [json.loads(line) for line in (ROOT / 'data/test.jsonl').read_text().splitlines()][:200]
    assert len({r['state'] for r in rows}) == len(rows) == 200
    config = {'model': MODEL, 'endpoint': 'https://openrouter.ai/api/v1/chat/completions',
              'max_tokens': 8192, 'reasoning_effort': 'medium', 'concurrency': 8,
              'credential_source': 'environment',
              'task_ids': [r['id'] for r in rows],
              'test_sha256': hashlib.sha256((ROOT / 'data/test.jsonl').read_bytes()).hexdigest(),
              'protocol': 'one full solution, at most 60 moves, exact solve reward'}
    if (OUT / 'config.json').exists():
        assert json.loads((OUT / 'config.json').read_text()) == config
    save(OUT / 'config.json', config)
    key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if not key:
        raise RuntimeError('Set OPENROUTER_API_KEY before evaluation')
    headers = {'Authorization': 'Bearer ' + key}
    with httpx.Client(timeout=600, headers=headers) as client:
        auth = client.get('https://openrouter.ai/api/v1/key', timeout=30)
        if auth.status_code != 200:
            raise RuntimeError(f'OpenRouter authentication failed: HTTP {auth.status_code}')

        def attempt(row):
            path = OUT / f"{row['id']}.json"
            if path.exists():
                return
            body = {'model': MODEL, 'messages': [{'role': 'user', 'content': prompt(row['state'])}],
                    'tools': [TOOL], 'max_tokens': 8192, 'reasoning': {'effort': 'medium'}}
            record = {'task_id': row['id'], 'state': row['state'], 'shuffle_length': row['shuffle_length'],
                      'request': body, 'started_at': datetime.now(timezone.utc).isoformat()}
            start = time.monotonic()
            try:
                response = client.post(config['endpoint'], json=body)
                record['http_status'] = response.status_code
                if response.status_code != 200:
                    record.update(status='api_error', error=f'HTTP {response.status_code}')
                else:
                    data = response.json()
                    record['response'] = data
                    record['usage'] = data.get('usage', {})
                    choice = data['choices'][0]
                    moves = submitted_moves(choice['message'])
                    finish = choice.get('finish_reason')
                    record.update(finish_reason=finish, moves=moves)
                    if finish == 'length':
                        record.update(status='output_limit', reward=0.0)
                    elif moves is None:
                        record.update(status='invalid_submission', reward=0.0)
                    else:
                        reward = grade(row['state'], moves)
                        record.update(status='solved' if reward else 'unsolved', reward=reward)
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                record.update(status='api_error', error=type(exc).__name__)
            finally:
                record['elapsed_seconds'] = time.monotonic() - start
                save(path, record)

        # Check one model request before submitting the remaining batch.
        attempt(rows[0])
        first = json.loads((OUT / f"{rows[0]['id']}.json").read_text())
        if first['status'] == 'api_error':
            summarize(rows)
            raise RuntimeError('First model request failed; bulk submission stopped')
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            for future in concurrent.futures.as_completed([pool.submit(attempt, row) for row in rows[1:]]):
                future.result()
                summarize(rows)
    result = summarize(rows)
    # Recompute all valid solution scores from saved moves.
    for row in rows:
        record = json.loads((OUT / f"{row['id']}.json").read_text())
        if record['status'] in ('solved', 'unsolved'):
            assert grade(row['state'], record['moves']) == record['reward']
    result['replay_verified'] = True
    save(OUT / 'results.json', result)


if __name__ == '__main__':
    main()
