# Rubik's Cube: Nemotron Lightning training

This example follows the cookbook's benchmark-runtime and reward-training workflow. It trains `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16` through the Trajectory SDK.

## Dataset

The generator starts with a solved cube and applies 1–20 random face turns. It uses seed `20260922` and rejects consecutive moves on the same axis. Shuffle length is not the shortest solution distance.

- 20,000 training tasks: 1,000 at each shuffle length.
- 18,177 distinct training states. Lengths 1 and 2 repeat states because they have few possible states under the shuffle rule.
- 1,857 distinct test states, with no state shared with training.
- A deterministic hash of the state assigns its split before sampling.
- Each local record includes the shuffle and its inverse as a verified reference solution. Neither is supplied to the model.
- `data/manifest.json` contains per-depth counts and SHA-256 hashes.

The image contains `cube_states.json`, which maps task IDs to cube states. Each task selects its state with `--task-id`. No task data is passed through environment variables. Only that current state is passed to the model. The model submits one complete move sequence, with a maximum of 60 moves, through `submit_solution`. The checker applies those exact moves and awards 1 only for a solved cube. Invalid or incomplete outputs score 0. Sticker matches are not used as a reward.

## Commands

See the [root README](../../README.md) for setup, generation, tests, and training.

The runtime uses an explicit trajectory ID for model calls, rewards, and completion. It uses `ENV_DONE` for a completed task and `ERROR` for a runtime failure. This protocol differs from the app's one-move-per-request test. Their scores are not directly comparable.

The workflow checks eight tasks before it starts 100 training steps. Each step uses four task groups and eight samples per group. It then evaluates the base model and final checkpoint on up to 200 test tasks each. Exact solve rewards can be sparse. Compare measured scores before you claim improvement.

Saved IDs in `artifacts/` let the workflow resume. Do not run two workflow processes at the same time. Do not share artifacts without checking their contents.
