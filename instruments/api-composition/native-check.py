import tempfile
import json
import os
import subprocess
from pathlib import Path

session = os.environ.get('API_PROOF_SESSION', 'munari-api-v2-native')
lab = os.environ.get('API_PROOF_URL', 'http://127.0.0.1:5173')
composition = os.environ.get('API_COMPOSITION_URL', 'http://127.0.0.1:5178')
output = Path(os.environ.get('API_PROOF_OUTPUT', str(Path(tempfile.gettempdir())/'munari-api/evidence')))
output.mkdir(parents=True, exist_ok=True)

def call(*args):
    result = subprocess.run(['agent-browser','--session',session,'--json',*args], capture_output=True, text=True, timeout=20)
    data = json.loads(result.stdout)
    if result.returncode or not data['success']:
        raise RuntimeError(result.stdout + result.stderr)
    return data.get('data', {})

def evaluate(code):
    return call('eval', code).get('result')

def wait(condition):
    assert evaluate('''new Promise(resolve=>{const start=performance.now();const check=()=>{
      if (''' + condition + ''') resolve(true);
      else if(performance.now()-start>8000) resolve(false);
      else setTimeout(check,30);
    };check()})'''), condition

call('open', lab + '/?scene=controls&framed')
wait('Boolean(window.__apiControls?.status)')
assert evaluate('typeof CanvasRenderingContext2D.prototype.drawElementImage') == 'undefined'
evaluate('window.originalControl=document.querySelector("[data-api-live] input");window.originalControl.setAttribute("data-native-probe","")')
call('fill', '[data-native-probe]', 'native fallback')
evaluate('window.__apiControls.request(true)')
wait('window.__apiControls.status.requestedInScene === true')
controls = evaluate('({status:window.__apiControls.status,same:window.originalControl===document.querySelector("[data-api-live] input"),value:window.originalControl.value,captures:[...document.querySelectorAll("canvas")].filter(canvas=>canvas.layoutSubtree).length})')
assert controls['same'] and controls['value'] == 'native fallback'
assert controls['status']['presentation'] == 'page'
assert controls['status']['supported'] is False
assert controls['captures'] == 0

call('open', composition + '/whole-page.html')
wait('window.__wholeCapture?.read()?.status.status === "unsupported"')
call('fill', '#native-note', 'uncaptured native input')
call('click', '#increment')
capture = evaluate('({status:window.__wholeCapture.read().status,frame:window.__wholeCapture.read().frame,count:window.__wholeCapture.record.count,value:document.getElementById("native-note").value,captures:[...document.querySelectorAll("canvas")].filter(canvas=>canvas.layoutSubtree).length})')
assert capture['frame'] is None and capture['captures'] == 0
assert capture['value'] == 'uncaptured native input' and capture['count'] == 1
result = {'controls':controls,'elementCapture':capture,'browser':evaluate('navigator.userAgent')}
(output / 'native-fallback.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
