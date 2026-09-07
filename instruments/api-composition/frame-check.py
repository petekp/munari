import tempfile
import json,os,subprocess
from pathlib import Path
session=os.environ.get('API_PROOF_SESSION','munari-api-all')
base=os.environ.get('API_COMPOSITION_URL','http://127.0.0.1:5174')
out=Path(os.environ.get('API_PROOF_OUTPUT',str(Path(tempfile.gettempdir())/'munari-api/evidence')))
out.mkdir(parents=True,exist_ok=True)
def call(*args):
 r=subprocess.run(['agent-browser','--session',session,'--json',*map(str,args)],capture_output=True,text=True,timeout=25)
 d=json.loads(r.stdout)
 if r.returncode or not d['success']:raise RuntimeError(r.stdout+r.stderr)
 return d.get('data',{})
def ev(code):return call('eval',code).get('result')
def wait(condition):
 assert ev('new Promise(resolve=>{const start=performance.now();const tick=()=>{if('+condition+')resolve(true);else if(performance.now()-start>8000)resolve(false);else setTimeout(tick,25)};tick()})'),condition
call('open',base)
wait('Boolean(window.__frameCompanion)')
call('click','#companion-toggle')
wait('window.__frameCompanion.frames >= 40')
record=ev('window.__frameCompanion')
assert record['mismatches']==0,record
assert record['naiveMismatches']>20,record
call('click','#companion-toggle')
wait('window.__frameCompanion.frames > '+str(record['frames']))
ev('new Promise(resolve=>setTimeout(resolve,600))')
before=ev('window.__frameCompanion.callbacks')
ev('new Promise(resolve=>setTimeout(resolve,200))')
after=ev('window.__frameCompanion.callbacks')
assert before==after,(before,after)
assert not call('errors').get('errors'),call('errors')
record['callbacksAfterRelease']=[before,after]
(out/'frame-companion.json').write_text(json.dumps(record,indent=2))
print(json.dumps(record))
