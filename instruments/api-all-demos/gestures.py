"""Focused gestures for migrated API callers that have no dedicated maintained gate."""
import tempfile
import json,os,subprocess
from pathlib import Path
session=os.environ.get('API_PROOF_SESSION','munari-api-all')
base=os.environ.get('API_LAB_URL','http://127.0.0.1:5173')
out=Path(os.environ.get('API_PROOF_OUTPUT',str(Path(tempfile.gettempdir())/'munari-api/evidence')))
out.mkdir(parents=True,exist_ok=True)
results=[]
def call(*args):
 if args[:2]==('mouse','move'):args=(*args[:2],round(float(args[2])),round(float(args[3])))
 r=subprocess.run(['agent-browser','--session',session,'--json',*map(str,args)],capture_output=True,text=True,timeout=30)
 d=json.loads(r.stdout)
 if r.returncode or not d['success']:raise RuntimeError(r.stdout+r.stderr)
 return d.get('data',{})
def ev(code):return call('eval',code).get('result')
def wait(condition):
 assert ev('new Promise(resolve=>{const start=performance.now();const tick=()=>{if('+condition+')resolve(true);else if(performance.now()-start>12000)resolve(false);else setTimeout(tick,25)};tick()})'),condition
mesh_count='(()=>{let count=0;window.__r3f?.scene.traverse(o=>{if(o.isMesh)count++});return count})()'
def open_case(scene,candidate=None):
 call('close')
 call(*(['--headed'] if os.environ.get('HEADED')=='1' else []),'--profile',str(Path(tempfile.gettempdir())/'munari-api-all-browser'),'--executable-path','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--args','--enable-features=CanvasDrawElement,--disable-backgrounding-occluded-windows,--disable-renderer-backgrounding','open',base+'/?scene='+scene+'&framed'+('&candidate='+candidate if candidate else ''))
 call('set','viewport',1200,860)
 wait('document.body.textContent.length > 20 && [...document.querySelectorAll("canvas")].some(c=>!c.layoutSubtree&&c.width>1)')
 ev('document.fonts.ready')
def click_at(x,y):
 call('mouse','move',round(x),round(y));call('mouse','down');call('mouse','up')
def center(selector):return ev('(()=>{const r=document.querySelector('+json.dumps(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
def record(name,detail):
 errors=call('errors').get('errors',[])
 assert not errors,errors
 row={'demo':name,'passed':True,**detail};results.append(row)
 (out/'gestures.json').write_text(json.dumps(results,indent=2));print(json.dumps(row),flush=True)

call('set','viewport',1200,860)
open_case('gravity')
wait('Boolean(window.__gravityApi)')
ev('window.wordOriginal=window.__gravityApi.elements()[0];window.wordPage=wordOriginal.parentElement.parentElement;window.secondWord=window.__gravityApi.elements()[1];window.secondBefore=secondWord.getBoundingClientRect().toJSON()')
p=center('[data-api-live] .gv-word')
call('mouse','move',p['x'],p['y']);call('mouse','down');call('mouse','move',620,370);call('mouse','up')
wait('window.__gravityApi.flights()[0]?.presented && window.__gravityApi.flights()[0]?.asleep')
assert ev('window.wordOriginal === window.__gravityApi.elements()[0] && window.wordOriginal.isConnected')
assert ev('getComputedStyle(window.wordPage).display')=='none'
assert ev('document.querySelector(".gv-poem div")') is None
assert ev('Math.abs(secondWord.getBoundingClientRect().x-secondBefore.x)+Math.abs(secondWord.getBoundingClientRect().y-secondBefore.y)>1')
call('screenshot',out/'gravity-fallen.png')
body=ev('window.__gravityApi.flights()[0]');click_at(body['x'],body['y'])
wait('window.__gravityApi.flights().length === 0 && !window.wordOriginal.closest("canvas")')
assert ev('getComputedStyle(window.wordPage).display')!='none'
record('gravity',{'sameElement':True,'inlineMarkup':True,'reflowed':True,'returned':True})

open_case('explode')
wait('window.__explode?.plates().length === 6')
ev('window.explodeOriginal=window.__explode.subject();window.__explode.setSpread(0)')
wait('window.__explode.spread() === 0')
assert ev('window.explodeOriginal === window.__explode.subject() && window.explodeOriginal.isConnected')
assert ev('document.querySelectorAll("[data-munari-surface^=plate-]").length')==6
call('screenshot',out/'explode-collapsed.png')
ev('window.__explode.setSpread(1)')
record('explode',{'adoptedPlates':6,'nativeSubjectPreserved':True,'spreadAndCollapse':True})

open_case('selection')
wait('Boolean(window.__r3f?.scene) && document.querySelector(".sel-prose p")')
r=ev('document.querySelector(".sel-prose p").getBoundingClientRect().toJSON()')
call('mouse','move',r['x']+5,r['y']+12);call('mouse','down');call('mouse','move',r['x']+260,r['y']+82);call('mouse','up')
wait('window.getSelection().toString().length > 20')
wait('(()=>{let ok=false;window.__r3f.scene.traverse(o=>{const u=o.material?.uniforms;if(u?.uRectCount?.value>0&&u.uT.value>0.9&&u.tMap.value)ok=true});return ok})()')
call('screenshot',out/'selection-active.png')
record('selection',{'nativeSelectedCharacters':ev('window.getSelection().toString().length'),'captureFeedsGlass':True})

for candidate in ['ripple','billow']:
 open_case('candidates',candidate)
 wait('document.querySelector("[data-api-live] .cand-btn")')
 call('click','[data-api-live] .cand-btn') if candidate=='billow' else call('click','[data-api-live] .cand-btn--primary')
 wait(mesh_count+' > 0')
 call('screenshot',out/(candidate+'-active.png'))
 wait(mesh_count+' === 0')
 record('candidate-'+candidate,{'pressDrewScene':True,'sceneReleased':True})

open_case('candidates','unroll')
call('click','button[aria-expanded]')
wait('document.querySelector(".cand-menu__item") && '+mesh_count+' > 0')
# A fully opened menu has an unwarped plane. Project a row through that mesh.
wait('(()=>{let open=false;window.__r3f.scene.traverse(o=>{if(o.material?.uniforms?.uOpacity?.value>0.99)open=true});return open})()')
p=ev('''(()=>{const source=document.querySelector('[data-munari-surface="unroll-menu"]');const item=source.querySelector('.cand-menu__item');const s=source.getBoundingClientRect(),r=item.getBoundingClientRect();let mesh;window.__r3f.scene.traverse(o=>{if(o.isMesh)mesh=o});mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;const point=mesh.position.clone().set(b.min.x+(b.max.x-b.min.x)*(r.x+r.width/2-s.x)/s.width,b.max.y-(b.max.y-b.min.y)*(r.y+r.height/2-s.y)/s.height,0);mesh.localToWorld(point).project(window.__r3f.camera);return {x:(point.x+1)*innerWidth/2,y:(1-point.y)*innerHeight/2,label:item.textContent}})()''')
click_at(p['x'],p['y'])
wait('document.querySelector(".cand-card--menu p").textContent.includes("Last action:")')
wait(mesh_count+' === 0')
record('candidate-unroll',{'action':p['label'],'menuClosed':True})

open_case('candidates','dissolve')
ev('window.dissolveOriginals=[...document.querySelectorAll("[data-api-live] .cand-shape")]')
call('click','.cand-slot:nth-child(1) [data-api-live] .cand-slot__hit')
wait('document.querySelector(".cand-slot:nth-child(2) [data-api-live] .cand-shape")?.closest("canvas") === null && document.querySelector(".cand-slot:nth-child(1) .cand-slot__empty")')
assert ev('window.dissolveOriginals.every((node,i)=>node===[...document.querySelectorAll("[data-api-live] .cand-shape")][i])')
call('click','.cand-slot:nth-child(2) [data-api-live] .cand-slot__hit')
wait('document.querySelector(".cand-slot:nth-child(1) [data-api-live] .cand-shape")?.closest("canvas") === null && document.querySelector(".cand-slot:nth-child(2) .cand-slot__empty")')
record('candidate-dissolve',{'bothDirections':True,'originalElementsRetained':True})

open_case('candidates','analyze')
call('click','.cand-agent button')
wait('document.querySelectorAll(".cand-findings li:not(.cand-findings__live)").length === 3')
wait(mesh_count+' === 0')
record('candidate-analyze',{'allBlocksAnalyzed':True,'sceneReleased':True})

open_case('candidates','copy')
call('click','.cand-code-bar button')
wait('document.querySelector(".cand-hint")?.textContent.includes("Copied 1")')
wait('document.querySelector(".cand-code-holder").dataset.gone !== "true"')
record('candidate-copy',{'copiedOnce':True,'nativeBlockRestored':True})

open_case('candidates','delete')
for index,variant in enumerate(['melt','shatter','peel']):
 call('click',f'[aria-label="delete style"] button:nth-child({index+1})')
 call('click','.cand-row-holder:first-child [data-api-live] .cand-row__x')
 wait('document.querySelectorAll(".cand-row-holder").length === 4')
 wait(mesh_count+' === 0')
 call('click','.cand-card--list > button')
 wait('document.querySelectorAll(".cand-row-holder").length === 5')
record('candidate-delete',{'variants':['melt','shatter','peel'],'removedAfterExit':True,'restored':True})

open_case('home')
wait('document.querySelector(".home-hero-holder [data-api-live] input")')
call('scrollintoview','.home-hero-row button')
ev('window.postcardOriginal=document.querySelector(".home-hero-holder [data-api-live] input")')
call('fill','.home-hero-holder [data-api-live] input','API review')
call('click','.home-hero-row button')
wait('document.querySelector(".home-hero-row .home-lamp").dataset.gl === "true"')
call('screenshot',out/'home-postcard-scene.png')
call('click','.home-hero-row button')
wait('document.querySelector(".home-hero-row .home-lamp").dataset.gl === "false"')
assert ev('postcardOriginal === document.querySelector(".home-hero-holder [data-api-live] input") && postcardOriginal.value === "API review"')
call('click','.home-starter-demo > div > button')
wait('document.querySelector(".home-starter-demo").textContent.includes("Drawn by the scene")')
call('click','.home-starter-demo > div > button')
wait('document.querySelector(".home-starter-demo").textContent.includes("Drawn by the page")')
record('home',{'postcardHandoff':True,'nativeInputIdentityAndValue':True,'independentStarterCanvas':True})
