"""Route coverage for the API experiment. Gestures live in the focused checks and maintained gates."""
import tempfile
import json,os,subprocess
from pathlib import Path
session=os.environ.get('API_PROOF_SESSION','munari-api-all')
base=os.environ.get('API_LAB_URL','http://127.0.0.1:5173')
out=Path(os.environ.get('API_PROOF_OUTPUT',str(Path(tempfile.gettempdir())/'munari-api/evidence')))
out.mkdir(parents=True,exist_ok=True)
def call(*args):
 r=subprocess.run(['agent-browser','--session',session,'--json',*args],capture_output=True,text=True,timeout=30)
 d=json.loads(r.stdout)
 if r.returncode or not d['success']:raise RuntimeError(r.stdout+r.stderr)
 return d.get('data',{})
def ev(code):return call('eval',code).get('result')
def wait(condition):
 assert ev('new Promise(resolve=>{const start=performance.now();const tick=()=>{if('+condition+')resolve(true);else if(performance.now()-start>15000)resolve(false);else setTimeout(tick,30)};tick()})'),condition
routes=['home','workspace','glass','flight','explode','genie','fisheye','slider','veil','knobs','optics','logo','selection','candidates','refraction','gallery','crystal','controls','marble-hand','plume','gravity','lamp','rain','wordmark']
studies=['ripple','billow','unroll','dissolve','analyze','copy','delete']
results=[]
call('set','viewport','1200','860')
for label,url in [(route,base+'/?scene='+route+'&framed') for route in routes]+[('candidate-'+study,base+'/?scene=candidates&candidate='+study+'&framed') for study in studies]:
 try:
  call('open',url)
  wait('document.body.textContent.length > 20 && [...document.querySelectorAll("canvas")].some(canvas => canvas.width > 1 && !canvas.layoutSubtree)')
  ev('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))')
  state=ev('({capable:typeof CanvasRenderingContext2D.prototype.drawElementImage === "function",liveRoots:document.querySelectorAll("[data-api-live]").length,sources:[...document.querySelectorAll("canvas")].filter(canvas=>canvas.layoutSubtree).length,graphics:[...document.querySelectorAll("canvas")].filter(canvas=>!canvas.layoutSubtree).length,text:document.querySelector("#root").textContent.slice(0,160)})')
  assert state['capable'],'Enhanced coverage requires actual capability'
  errors=call('errors').get('errors',[])
  assert not errors,errors
  call('screenshot',str(out/(label+'.png')))
  results.append({'demo':label,'passed':True,**state})
 except Exception as error:results.append({'demo':label,'passed':False,'error':str(error)})
 (out/'route-smoke.json').write_text(json.dumps(results,indent=2))
 print(json.dumps(results[-1]),flush=True)
assert all(row['passed'] for row in results),[row for row in results if not row['passed']]
