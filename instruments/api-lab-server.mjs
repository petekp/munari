import path from 'node:path'
import { createServer } from 'vite'
const root=path.resolve(import.meta.dirname,'../apps/lab')
const server=await createServer({root,configFile:path.join(root,'vite.config.ts'),cacheDir:path.join(root,'node_modules/.vite-api-proof'),server:{host:'127.0.0.1',port:0,watch:{usePolling:true,interval:250},fs:{allow:[path.resolve(root,'../..')]}},logLevel:'warn'})
server.watcher.add(path.resolve(root,'../../packages/react/src'))
await server.listen()
console.log(`API lab: http://127.0.0.1:${server.httpServer.address().port}`)
process.on('SIGTERM',async()=>{await server.close();process.exit(0)})
