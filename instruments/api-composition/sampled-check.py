import tempfile
import json,os,subprocess
from pathlib import Path
from png_pixel import pixel_at
session=os.environ.get('API_PROOF_SESSION','munari-api-all')
base=os.environ.get('API_COMPOSITION_URL','http://127.0.0.1:5174')
out=Path(os.environ.get('API_PROOF_OUTPUT',str(Path(tempfile.gettempdir())/'munari-api/evidence')))
out.mkdir(parents=True,exist_ok=True)
def call(*args):
 r=subprocess.run(['agent-browser','--session',session,'--json',*args],capture_output=True,text=True,timeout=25)
 d=json.loads(r.stdout)
 if r.returncode or not d['success']:raise RuntimeError(r.stdout+r.stderr)
 return d.get('data',{})
def ev(code):return call('eval',code).get('result')
def wait(condition):
 assert ev('new Promise(resolve=>{const start=performance.now();const tick=()=>{if('+condition+')resolve(true);else if(performance.now()-start>8000)resolve(false);else setTimeout(tick,30)};tick()})'),condition
call('open',base)
wait('Boolean(window.__sampledParts)')
assert ev('Object.hasOwn(window.__sampledParts,"sceneReady")'), 'The fixture must load the current public API'
call('scrollintoview','#sampled-toggle')
box=ev('document.getElementById("sampled-page").getBoundingClientRect().toJSON()')
call('click','#sampled-toggle')
wait('window.__sampledParts.requestedInScene')
# Deliberately observe the missing-source interval. This is not a readiness timer.
ev('new Promise(resolve=>setTimeout(resolve,300))')
assert ev('window.__sampledParts.presentation')=='page'
assert not ev('window.__sampledParts.sceneReady')
call('click','#sampled-source')
wait('window.__sampledParts.presentation === "scene" && !window.__sampledParts.isTransitioning')
call('screenshot',str(out/'sampled-parts.png'))
left=pixel_at(out/'sampled-parts.png',int(box['x']+70),int(box['y']+90))
right=pixel_at(out/'sampled-parts.png',int(box['x']+230),int(box['y']+90))
assert left[:3]==[255,0,0],left
assert right[:3]==[0,0,255],right
call('click','#sampled-toggle')
wait('window.__sampledParts.presentation === "page" && !window.__sampledParts.isTransitioning')
assert not call('errors').get('errors'),call('errors')
result={'pendingUntilSecondSource':True,'oneDrawTwoSources':True,'leftPixel':left,'rightPixel':right,'returned':True}
(out/'sampled-parts.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
