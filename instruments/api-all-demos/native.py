"""Native outcomes must not wait for a scene animation that cannot run."""
import tempfile
import json,os,subprocess
from pathlib import Path
session=os.environ.get('API_PROOF_SESSION','munari-api-native')
base=os.environ.get('API_LAB_URL','http://127.0.0.1:5173')
out=Path(os.environ.get('API_PROOF_OUTPUT',str(Path(tempfile.gettempdir())/'munari-api/evidence')))
out.mkdir(parents=True,exist_ok=True)
results=[]
def call(*args):
 r=subprocess.run(['agent-browser','--session',session,'--json',*map(str,args)],capture_output=True,text=True,timeout=25)
 d=json.loads(r.stdout)
 if r.returncode or not d['success']:raise RuntimeError(r.stdout+r.stderr)
 return d.get('data',{})
def ev(code):return call('eval',code).get('result')
def wait(condition):
 assert ev('new Promise(resolve=>{const start=performance.now();const tick=()=>{if('+condition+')resolve(true);else if(performance.now()-start>8000)resolve(false);else setTimeout(tick,25)};tick()})'),condition
for candidate in ['unroll','dissolve','copy','delete']:
 call('open',base+'/?scene=candidates&candidate='+candidate+'&framed')
 wait('document.querySelector(".cand-page")')
 assert ev('typeof CanvasRenderingContext2D.prototype.drawElementImage')=='undefined'
 if candidate=='unroll':
  call('click','button[aria-expanded]')
  call('click','.cand-menu__item:first-child')
  wait('document.querySelector(".cand-card--menu p").textContent.includes("Last action: Duplicate")')
 elif candidate=='dissolve':
  call('click','.cand-slot:nth-child(1) [data-api-live] .cand-slot__hit')
  wait('Boolean(document.querySelector(".cand-slot:nth-child(1) .cand-slot__empty"))')
  call('click','.cand-slot:nth-child(2) [data-api-live] .cand-slot__hit')
  wait('Boolean(document.querySelector(".cand-slot:nth-child(2) .cand-slot__empty"))')
 elif candidate=='copy':
  call('click','.cand-code-bar button')
  wait('document.querySelector(".cand-hint").textContent.includes("Copied 1")')
  assert ev('document.querySelector(".cand-code-holder").dataset.gone') is None
 else:
  call('click','.cand-row-holder:first-child [data-api-live] .cand-row__x')
  wait('document.querySelectorAll(".cand-row-holder").length === 4')
 assert ev('[...document.querySelectorAll("canvas")].filter(c=>c.layoutSubtree).length')==0
 assert not call('errors').get('errors'),call('errors')
 results.append({'demo':'candidate-'+candidate,'passed':True,'captureCanvases':0})
call('open',base+'/?scene=selection&framed')
wait('Boolean(window.__r3f?.scene)')
ev('const r=document.createRange();r.selectNodeContents(document.querySelector(".sel-prose p"));getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event("selectionchange"))')
assert ev('getSelection().toString().length')>20
assert ev('(()=>{let visible=0;window.__r3f.scene.traverse(o=>{if(o.isMesh&&o.visible)visible++});return visible})()')==0
results.append({'demo':'selection','passed':True,'nativeSelection':True,'visibleCaptureMeshes':0})
call('open',base+'/?scene=gravity&framed')
wait('document.querySelectorAll(".gv-word").length === 47 && document.querySelector(".gv-canvas")')
call('click','.gv-word:first-child')
wait('document.querySelector(".gv-word").style.display === "none"')
results.append({'demo':'gravity','passed':True,'existingRendererFallback':True})
(out/'native-gestures.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
