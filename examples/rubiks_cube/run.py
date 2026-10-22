"""Resume registration, check the runtime, and run the saved experiment."""
from ingest import main as ingest
from train import main as train

if __name__=='__main__':
    ingest()
    train()
