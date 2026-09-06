import tempfile
import subprocess,json,os
from pathlib import Path
out=Path(os.environ.get('API_PROOF_OUTPUT',str(Path(tempfile.gettempdir())/'munari-api/evidence')));out.mkdir(exist_ok=True)
BASE=os.environ.get('API_PROOF_URL','http://127.0.0.1:5178')
def call(*args):
 p=subprocess.run(['agent-browser','--session',os.environ.get('API_PROOF_SESSION','munari-api-proof'),'--json',*args],capture_output=True,text=True);d=json.loads(p.stdout)
 if p.returncode or not d['success']:raise RuntimeError(p.stdout+p.stderr)
 return d.get('data',{})
def ev(code):return call('eval',code).get('result')
def wait(code):call('wait','--fn',code)
call('set','viewport','1280','900')
call('errors','--clear');call('console','--clear')
call('open',BASE+'/?scene=controls&framed&delayScene')
wait('window.__apiControls?.status?.supported && !!document.querySelector("[data-api-live] input")')
ev('window.__focusInput=document.querySelector("[data-api-live] input");window.__focusInput.setAttribute("data-focus-proof","")')
call('fill','[data-api-live] [data-focus-proof]','State before delayed preparation')
call('focus','[data-api-live] [data-focus-proof]')
ev('window.__focusInput.setSelectionRange(2,7);window.__apiControls.request(true)')
wait('window.__apiControls.status.isTransitioning && !window.__apiControls.sceneResolved')
preparing=ev('({status:window.__apiControls.status,focus:document.activeElement===window.__focusInput,selection:[window.__focusInput.selectionStart,window.__focusInput.selectionEnd],frames:window.__apiControls.frames.length})')
assert preparing['status']['presentation']=='page' and preparing['focus'] and preparing['frames']==0
call('click','[data-api-live] button[type="submit"]')
action=ev('({resolved:window.__apiControls.sceneResolved,actions:window.__apiControls.actions,status:window.__apiControls.status})')
assert len(action['actions'])==1 and action['actions'][0]['trusted'] and not action['resolved']
call('focus','[data-api-live] [data-focus-proof]')
ev('window.__focusInput.setSelectionRange(2,7)')
wait('window.__apiControls.status.presentation==="scene" && !window.__apiControls.status.isTransitioning')
entered=ev('({status:window.__apiControls.status,focus:document.activeElement===window.__focusInput,selection:[window.__focusInput.selectionStart,window.__focusInput.selectionEnd]})')
assert entered['focus'] and entered['selection']==[2,7]
call('fill','[data-api-live] [data-focus-proof]','Typed in the scene')
ev('window.__focusInput.setSelectionRange(3,8);window.__apiControls.request(false)')
wait('window.__apiControls.status.presentation==="page" && !window.__apiControls.status.isTransitioning')
returned=ev('({status:window.__apiControls.status,focus:document.activeElement===window.__focusInput,selection:[window.__focusInput.selectionStart,window.__focusInput.selectionEnd],same:window.__focusInput===document.querySelector("[data-api-live] input"),value:window.__focusInput.value})')
assert returned['focus'] and returned['selection']==[3,8] and returned['same'] and returned['value']=='Typed in the scene'
ev('document.querySelector(".controls-page").style.transformOrigin="0 0";document.querySelector(".controls-page").style.transform="translate(24px,12px) scale(0.9)";window.__apiControls.request(true)')
wait('window.__apiControls.status.presentation==="scene" && !window.__apiControls.status.isTransitioning')
count=ev('window.__apiControls.actions.length')
call('click','[data-api-live] button[type="submit"]')
scaled=ev('({actions:window.__apiControls.actions.length,last:window.__apiControls.actions.at(-1),status:window.__apiControls.status})')
assert scaled['actions']==count+1 and scaled['last']['trusted']
ev('document.querySelector(".controls-page").style.transform="";window.__apiControls.request(false)')
wait('window.__apiControls.status.presentation==="page" && !window.__apiControls.status.isTransitioning')
ev('window.__constructors=0;customElements.define("api-content-probe",class extends HTMLElement{constructor(){super();window.__constructors++}});const el=document.createElement("api-content-probe");el.textContent="Native widget";document.querySelector("[data-api-live]").append(el)')
wait('window.__apiControls.status.reason !== null')
ev('window.__apiControls.request(true)')
wait('window.__apiControls.status.requestedInScene === true')
guard=ev('({status:window.__apiControls.status,constructors:window.__constructors,widgets:document.querySelectorAll("api-content-probe").length})')
assert guard['constructors']==1 and guard['widgets']==1 and guard['status']['presentation']=='page' and not guard['status']['supported']
errors=call('errors');assert not errors.get('errors')
result={'preparation':preparing,'trustedInputDuringPreparation':action,'entered':entered,'returned':returned,'scaledAncestor':scaled,'unsupportedContent':guard,'errors':errors}
(out/'focus-preparation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
