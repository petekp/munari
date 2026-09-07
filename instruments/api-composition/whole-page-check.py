import tempfile
import json
import os
import subprocess
from pathlib import Path

session = os.environ.get('API_PROOF_SESSION', 'munari-api-v2')
base = os.environ.get('API_COMPOSITION_URL', 'http://127.0.0.1:5178')
output = Path(os.environ.get('API_PROOF_OUTPUT', str(Path(tempfile.gettempdir())/'munari-api/evidence')))
output.mkdir(parents=True, exist_ok=True)

def call(*args):
    result = subprocess.run(['agent-browser', '--session', session, '--json', *args], capture_output=True, text=True, timeout=20)
    data = json.loads(result.stdout)
    if result.returncode or not data['success']:
        raise RuntimeError(result.stdout + result.stderr)
    return data.get('data', {})

def evaluate(code):
    return call('eval', code).get('result')

def wait(condition):
    result = evaluate('''new Promise(resolve=>{const start=performance.now();const check=()=>{
      if (''' + condition + ''') resolve(true);
      else if(performance.now()-start>8000) resolve(false);
      else setTimeout(check,30);
    };check()})''')
    assert result, condition

call('open', base + '/whole-page.html')
call('errors', '--clear')
wait('Boolean(window.__wholeCapture?.record.sample)')
html = evaluate('window.__wholeCapture.record.sample')
assert html['height'] == 1800
assert html['top'] == [36,96,192,255]
assert html['bottom'] == [180,40,80,255]
evaluate('window.originalNote=document.getElementById("native-note")')
call('fill', '#native-note', 'The original stays editable')
call('click', '#increment')
call('click', '#target-kind')
wait('window.__wholeCapture.record.kind === "body" && window.__wholeCapture.read().status.status === "ready"')
body = evaluate('window.__wholeCapture.record.sample')
assert body['sourceId'] != html['sourceId']
assert body['height'] == 1800
assert body['top'] == html['top'] and body['bottom'] == html['bottom']
assert evaluate('document.getElementById("native-note") === window.originalNote')
assert evaluate('window.originalNote.value') == 'The original stays editable'
assert evaluate('document.body.inert') is False
assert evaluate('window.__wholeCapture.record.count') == 1
evaluate('new Promise(resolve=>setTimeout(resolve,250))')
before = evaluate('window.__wholeCapture.read().frame.revision')
evaluate('new Promise(resolve=>setTimeout(resolve,500))')
after = evaluate('window.__wholeCapture.read().frame.revision')
assert before == after, (before, after)
result = {'html':html,'body':body,'nativeValue':evaluate('window.originalNote.value'),'count':1,'bodyInert':False,'idleRevisions':[before,after]}
(output / 'whole-page.json').write_text(json.dumps(result, indent=2) + '\n')
call('screenshot', str(output / 'whole-page.png'))
print(json.dumps(result, indent=2))
