import tempfile
import json,os
from pathlib import Path
from PIL import Image
import numpy as np
folder=Path(os.environ.get('API_PROOF_OUTPUT',str(Path(tempfile.gettempdir())/'munari-api/evidence/postcard-scroll')))
record=json.loads((folder/'record.json').read_text())
def marker_positions(path):
 a=np.asarray(Image.open(path).convert('RGB'))
 blue=(a[:,:,2]>220)&(a[:,:,0]<35)&(a[:,:,1]<35)
 magenta=(a[:,:,2]>220)&(a[:,:,0]>220)&(a[:,:,1]<35)
 if blue.sum()<4 or magenta.sum()<4:return None
 return float(np.where(blue)[0].mean()),float(np.where(magenta)[0].mean())
initial=marker_positions(folder/'before.png')
assert initial, 'Both markers must be visible before scrolling'
base=initial[0]-initial[1]
rows=[]
for i in range(record['frames']):
 positions=marker_positions(folder/f'frame-{i}.png')
 if positions:rows.append({'frame':i,'offset':positions[0]-positions[1]-base})
assert len(rows)>10,rows
result={'framesMeasured':len(rows),'maxRelativeDrift':max(abs(row['offset']) for row in rows),'samples':rows}
(folder/'pixels.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
assert result['maxRelativeDrift']<=1.5,result
