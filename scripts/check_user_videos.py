"""Run baseline diagnostics on five user-provided domains, without test-time tuning."""
import json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if __name__=='__main__':
 rows=json.loads((ROOT/'data/user-materials/inventory.json').read_text())
 for row,start in zip(rows,[60,180,60,300,240],strict=True):
  subprocess.run([sys.executable,str(ROOT/'scripts/analyze_local.py'),'--video',row['path'],'--start',str(start),'--seconds','20','--fps','4','--out',str(ROOT/'data/user-materials/diagnostics'/row['id'])],check=True)
