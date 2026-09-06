import path from 'node:path'
import { createServer } from 'vite'
const server=await createServer({configFile:false,cacheDir:path.join(import.meta.dirname,'node_modules/.vite'),root:import.meta.dirname,server:{host:'127.0.0.1',port:0,watch:{usePolling:true,interval:250},fs:{allow:[path.resolve(import.meta.dirname,'../..')]}},esbuild:{jsx:'automatic'},logLevel:'warn'})
server.watcher.add(path.resolve(import.meta.dirname,'../../packages/react/src'))
await server.listen()
console.log(`Capture probe: http://127.0.0.1:${server.httpServer.address().port}`)
process.on('SIGTERM',async()=>{await server.close();process.exit(0)})
