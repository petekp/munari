// Run the postcard contracts serially; timing has no screencast observer.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const output=process.env.API_PROOF_OUTPUT ?? path.join(tmpdir(),'munari-api','evidence')
await mkdir(output,{recursive:true})
for(const [file,name,extra] of [
  ['postcard-continuity.mjs','postcard-timing',{POSTCARD_INPUT:'pointer',POSTCARD_RECORD:'0',POSTCARD_CYCLES:'6'}],
  ['postcard-continuity.mjs','postcard-pixels',{POSTCARD_INPUT:'fixed-light',POSTCARD_RECORD:'1',POSTCARD_CYCLES:'6'}],
  ['postcard-scroll.mjs','postcard-scroll',{}],
  ['home-form.mjs','home-form',{}],
]){
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(import.meta.dirname,file)],{
      env:{...process.env,...extra,API_PROOF_OUTPUT:path.join(output,name)},stdio:'inherit',
    })
    const deadline=setTimeout(()=>child.kill('SIGTERM'),180_000)
    child.on('error',error=>{clearTimeout(deadline);reject(error)})
    child.on('exit',(status,signal)=>{clearTimeout(deadline);resolve(signal?1:status)})
  })
  if(code!==0)throw new Error(`${name} failed; inspect ${path.join(output,name)}`)
}
console.log(`Postcard contracts passed. Evidence: ${output}`)
