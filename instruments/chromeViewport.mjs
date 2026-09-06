// Visible checks preserve native density; explicit DPR emulation is opt-in.
const nativeDensities=new WeakMap()
export async function setChromeViewport(page,{width,height,deviceScaleFactor}={}) {
 const browser=page.browser()
 let native=nativeDensities.get(browser)
 if(!native){native=await page.evaluate(()=>devicePixelRatio);nativeDensities.set(browser,native)}
 const requested=deviceScaleFactor??(process.env.TEST_DPR?Number(process.env.TEST_DPR):native)
 if(!Number.isFinite(requested)||requested<=0)throw new Error('TEST_DPR must be positive and finite')
 if(requested===native&&width>=500){
  const cdp=await page.createCDPSession()
  try{
   const {windowId,bounds}=await cdp.send('Browser.getWindowForTarget')
   const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
   await cdp.send('Browser.setWindowBounds',{windowId,bounds:{width:bounds.width+width-actual.width,height:bounds.height+height-actual.height}})
   await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{timeout:1000},{width,height})
   return native
  }catch{
   // Mobile layouts and window-manager limits need viewport emulation.
  }finally{await cdp.detach()}
 }
 await page.setViewport({width,height,deviceScaleFactor:requested})
 return requested
}
