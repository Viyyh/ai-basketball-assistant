"""Check reviewed annotation snapshot and admission gates; never auto-approve changes."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def validate():
 base=ROOT/'datasets/library'
 for name,expected in json.loads((base/'review-inputs-v0.1.json').read_text()).items():
  if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=expected:raise ValueError(f'Annotation changed; requires renewed review: {name}')
 rows=[json.loads(x) for x in (base/'records-v0.1.jsonl').read_text().splitlines()]
 assert len(rows)==len({r['id'] for r in rows})
 for row in rows:
  assert hashlib.sha256((ROOT/row['media_path']).read_bytes()).hexdigest()==row['sha256'],row['id']
  assert row['training_ready'] is False and row['exact_gold_label'] is False
  if row['admission']=='accepted_scoped':assert row['kind'] in ['frame','shot','hoop_crop']
  if row['kind']=='tactic_sample':assert row['admission']=='quarantined_pending'
 print(f'PASS {len(rows)} records; snapshot, media hashes and admission gates')
if __name__=='__main__':validate()
