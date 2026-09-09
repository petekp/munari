"""Compare companion pixels outside the card at each actual handoff."""
import tempfile
import json,os
from pathlib import Path
from PIL import Image
import numpy as np
folder=Path(os.environ.get('API_PROOF_OUTPUT',str(Path(tempfile.gettempdir())/'munari-api/evidence/postcard')))
record=json.loads((folder/'record.json').read_text())
first=Image.open(folder/'frame-0000.png')
w,h=first.size
box=record['box']
y,x=np.mgrid[:h,:w]
# A fixed light casts the shadow to the right and below the postcard.
mask=(((x>box['right']+3)&(x<box['right']+60)&(y>box['top']+10)&(y<box['bottom']+40))|((y>box['bottom']+3)&(y<box['bottom']+45)&(x>box['left']+20)&(x<box['right']+60)))
for rect in record['exclude']:
 mask &= ~((x>=rect['left']-2)&(x<=rect['right']+2)&(y>=rect['top']-2)&(y<=rect['bottom']+2))
assert mask.sum()>1000,mask.sum()
samples=[np.asarray(Image.open(folder/f"frame-{image['index']:04d}.png").convert('RGB'),dtype=np.float32)[mask] for image in record['images']]
def difference(a,b):return float(np.abs(samples[a]-samples[b]).mean())
checks=[]
for hold in record['holds']:
 after=next((i for i,image in enumerate(record['images']) if image['time']>=hold['time']),None)
 if after is None or after<1:raise AssertionError('No frames straddle the handoff')
 candidates=range(max(1,after-2),min(len(samples)-1,after+3))
 spikes=[max(0,(difference(i-1,i)+difference(i,i+1)-difference(i-1,i+1))/2) for i in candidates]
 checks.append({'scene':hold['scene'],'time':hold['time'],'before':after-1,'after':after,'boundaryMae':difference(after-1,after),'singleFrameSpike':max(spikes,default=0)})
result={'sampledPixels':int(mask.sum()),'checks':checks,'maxBoundaryMae':max(check['boundaryMae'] for check in checks),'maxSingleFrameSpike':max(check['singleFrameSpike'] for check in checks),'peakMotionMae':max(difference(0,i) for i in range(len(samples)))}
(folder/'pixels.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
# At rest both paths use the same analytic shadow. Half an 8-bit level
# allows compositor rounding while rejecting a visible extra or missing shadow.
assert result['maxBoundaryMae'] <= 0.5, result
assert result['maxSingleFrameSpike'] <= 0.5, result
assert result['peakMotionMae'] > 0.5, 'The sampled region did not observe the moving companion.'
