FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/rubiks_cube
RUN python -m pip install --no-cache-dir --upgrade trajectory-sdk
COPY cube_harness.py engine.cjs cube.cjs cube.LICENSE cube_states.json /opt/rubiks_cube/
CMD ["sleep", "infinity"]
