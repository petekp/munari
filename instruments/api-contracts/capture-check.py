import tempfile
import subprocess,json,os
from pathlib import Path
out=Path(os.environ.get('API_PROOF_OUTPUT',str(Path(tempfile.gettempdir())/'munari-api/evidence')));out.mkdir(exist_ok=True)
BASE=os.environ.get('API_PROOF_URL','http://127.0.0.1:5178')
def call(*args):
 p=subprocess.run(['agent-browser','--session',os.environ.get('API_PROOF_SESSION','munari-api-proof'),'--json',*args],capture_output=True,text=True)
 data=json.loads(p.stdout)
 if p.returncode or not data['success']:raise RuntimeError(p.stdout+p.stderr)
 return data.get('data',{})
def evaluate(code):return call('eval',code).get('result')
def wait(code):call('wait','--fn',code)
def read():return evaluate('window.__captureProbe.read()')
call('open',os.environ.get('API_CAPTURE_URL',BASE))
wait('window.__captureProbe?.read().latest.a?.pixel?.[0] === 36 && window.__captureProbe.read().latest.b?.pixel?.[0] === 36')
initial=read();results={'initial':initial}
assert evaluate('Object.hasOwn(window.__apiControls.status,"sceneReady")'), 'The capture fixture must load the current public API'
assert initial['consumers']==2
assert initial['latest']['a']['uuid']==initial['latest']['b']['uuid']
evaluate('window.__captureProbe.paint("rgb(180,40,80)","Frame two")')
wait('window.__captureProbe.read().latest.a?.pixel?.[0] === 180 && window.__captureProbe.read().latest.b?.pixel?.[0] === 180')
changed=read();results['changed']=changed
assert changed['renders']==initial['renders']
assert changed['frame']['uuid']==initial['frame']['uuid']
assert changed['frame']['generation']>initial['frame']['generation']
evaluate('window.__captureProbe.resize(320,180)')
wait('window.__captureProbe.read().latest.a?.width === 320 && window.__captureProbe.read().latest.b?.width === 320 && window.__captureProbe.read().latest.a?.anchor?.x === 24')
resized=read();results['resized']=resized
assert resized['frame']['uuid']==initial['frame']['uuid']
beforeDispose=resized['disposal']
evaluate('window.__captureProbe.showSecond(false)')
wait('window.__captureProbe.read().consumers === 1')
one=read();results['oneHost']=one
assert one['disposal']==beforeDispose
beforeB=one['draws']['b']
evaluate('window.__captureProbe.paint("rgb(21,148,110)","Frame three")')
wait('window.__captureProbe.read().latest.a?.pixel?.[0] === 21')
continued=read();results['continued']=continued
assert continued['draws']['b']==beforeB
idle=evaluate('(async()=>{const samples=[];for(let i=0;i<3;i++){const r=window.__captureProbe.read();samples.push({t:performance.now(),draws:r.draws.a,revision:r.frame.revision});if(i<2)await new Promise(resolve=>setTimeout(resolve,500))}return samples})()')
assert len({(r['draws'],r['revision']) for r in idle})==1
results['idleWindows']=idle
evaluate('window.__captureProbe.showSource(false)')
wait('window.__captureProbe.read().status.status === "waiting" && window.__captureProbe.read().latest.a?.empty === true')
removed=read();results['removed']=removed
assert removed['frame'] is None
old=continued['frame']['sourceId']
evaluate('window.__captureProbe.showSource(true)')
wait('window.__captureProbe.read().latest.a?.pixel?.[0] === 21 && window.__captureProbe.read().frame?.sourceId !== '+str(old))
remounted=read();results['remounted']=remounted
assert remounted['frame']['uuid']!=continued['frame']['uuid']
old=remounted['frame']['sourceId']
evaluate('window.__captureProbe.replace()')
wait('window.__captureProbe.read().latest.a?.pixel?.[0] === 36 && window.__captureProbe.read().frame?.sourceId !== '+str(old)+' && window.__captureProbe.read().latest.a?.width === 200')
replaced=read();results['replaced']=replaced
call('screenshot',str(out/'mixed-hosts.png'))
evaluate('window.__captureProbe.invalid()')
wait('window.__captureProbe.read().status.status === "error"')
error=read();results['invalidSource']=error
assert error['frame'] is None
assert evaluate('document.getElementById("parented-source").inert') is False
evaluate('window.__captureProbe.showSource(false)')
wait('window.__captureProbe.read().status.status === "waiting"')
(out/'capture-hosts.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({k:{'status':v.get('status'),'consumers':v.get('consumers'),'frame':v.get('frame'),'draws':v.get('draws'),'renders':v.get('renders')} if isinstance(v,dict) else v for k,v in results.items()},indent=2))
