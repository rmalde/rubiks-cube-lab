# Rubik's Cube Lab

A local cube app, repeatable cube tasks, and scripts for model tests and Nemotron Lightning training.

## Contents

- `cube-arena/`: 3D cube app and OpenRouter tests, with saved moves and replay checks.
- `examples/rubiks_cube/`: dataset generator, exact solve checker, Trajectory training workflow, and a direct GPT-6 Luna test through OpenRouter.

This is a development setup. This repository does not include a trained checkpoint or a measured GPT-6 Luna score. Provider model access and current API support are required for live runs.

## Local cube app

Use Node.js 20 or later. Set `OPENROUTER_API_KEY` in your shell before you start a model test. Do not put the key in a source file.

```sh
cd cube-arena
npm ci
npm test
npm run build
npm start
```

Open http://127.0.0.1:4317. Use a different `PORT` if that port is in use. Manual cube controls do not need an API key. Model tests make paid API calls.

The default key source is the environment. To use Google Secret Manager, set `CUBE_ARENA_KEY_SOURCE=secret-manager` and `GOOGLE_CLOUD_PROJECT` to your project. Sign in with the Google Cloud CLI. The secret name is `OPENROUTER_API_KEY`.

The app supports up to 500 requests per model. It has three protocols: original state and history; plan memory with possible next states; and an explicitly solver-assisted control. Only the last protocol uses a solver. A solver-assisted result is not an independent model solve. Run `npm run verify` to replay saved records.

## Generate and check the dataset

Run from the repository root. Use Python 3.11 or later and Node.js 20 or later.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
node examples/rubiks_cube/generate.cjs
node examples/rubiks_cube/verify_dataset.cjs
.venv/bin/python -m pytest examples/rubiks_cube/tests -q
```

Each task starts solved and gets 1–20 random face turns. The generator makes 20,000 training records and 1,857 distinct test states with no training overlap. Shallow training states repeat. Shuffle length is not the shortest solution distance. The seed is fixed. Local records contain inverse reference solutions for checks; the runtime package contains only task IDs and cube states.

The model sees the current state in URFDLB order and must submit a full solution of at most 60 moves. The checker applies the submitted moves. Only a fully solved cube earns reward 1. Other outputs earn 0.

## Train with Trajectory

Set `TRAJECTORY_API_KEY` in your shell. Use an agent ID from your own account. This command prints the available agents:

```sh
.venv/bin/python -c 'from trajectory import Client; print(Client().agents.list())'
```

Create `examples/rubiks_cube/artifacts/agent.json` with your selected agent ID:

```json
{"agent_id": "YOUR_AGENT_ID"}
```

Then run:

```sh
.venv/bin/python examples/rubiks_cube/run.py
```

This uploads the runtime, checks eight tasks, starts a paid 100-step training job for `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16`, and evaluates the base and final models. Docker must be available for the runtime upload. Run the same command to resume saved jobs. See [training details](examples/rubiks_cube/README.md).

## Direct GPT-6 Luna test

Set `OPENROUTER_API_KEY`, generate the dataset, then run:

```sh
.venv/bin/python examples/rubiks_cube/direct_luna.py
```

This makes paid OpenRouter calls without Trajectory. It tests the first 200 held-out tasks with eight concurrent requests, medium reasoning, and an 8,192-token output limit. Results and replay checks go in `examples/rubiks_cube/artifacts/direct-luna/`. API errors are recorded separately. Remove or move that directory only when you want a new run.

## Source and licenses

The training setup was developed with the [Trajectory cookbook](https://github.com/Trajectorylabs/trajectory-cookbook), revision `5aaa669`. The root Apache 2.0 license is retained. The vendored cube.js engine and solver are from [ldez/cubejs](https://github.com/ldez/cubejs); their MIT notices are retained in both engine directories. The app uses Three.js.

Keys, generated datasets, account IDs, and past run records are excluded from this repository.
