// Lamp cord — a tensioned chain between the ceiling and the positioned bulb.
// A rigid rotating cylinder cannot carry a bend or let it settle. Fixed-step
// integration and distance constraints keep drag speed out of the solver (#52).

export const CORD_POINTS = 28
const STEP = 1/120
const GRAVITY = 650
const DAMPING = 3.8
const ITERATIONS = 18

export interface LampCord {
  points: Float64Array
  previous: Float64Array
  anchorX: number
  endX: number
  endY: number
  remainder: number
  initialized: boolean
}

export function createLampCord(): LampCord {
  return {points:new Float64Array(CORD_POINTS*2),previous:new Float64Array(CORD_POINTS*2),anchorX:0,endX:0,endY:0,remainder:0,initialized:false}
}

function pin(cord: LampCord,x:number,y:number){
  cord.points[0]=cord.anchorX;cord.points[1]=-100
  cord.points[(CORD_POINTS-1)*2]=x;cord.points[(CORD_POINTS-1)*2+1]=y
  cord.previous[0]=cord.anchorX;cord.previous[1]=-100
  cord.previous[(CORD_POINTS-1)*2]=x;cord.previous[(CORD_POINTS-1)*2+1]=y
}

function reset(cord: LampCord,x:number,y:number){
  for(let i=0;i<CORD_POINTS;i++){
    const t=i/(CORD_POINTS-1)
    cord.points[i*2]=cord.anchorX+(x-cord.anchorX)*t
    cord.points[i*2+1]=-100+(y+100)*t
  }
  cord.previous.set(cord.points);cord.remainder=0
}

function segment(cord:LampCord,a:number,b:number,length:number){
  const p=cord.points,dx=p[b*2]!-p[a*2]!,dy=p[b*2+1]!-p[a*2+1]!,distance=Math.hypot(dx,dy)
  if(distance<.0001)return
  const wa=a===0?0:1,wb=b===CORD_POINTS-1?0:1,k=(distance-length)/(distance*(wa+wb))
  p[a*2]!+=dx*k*wa;p[a*2+1]!+=dy*k*wa
  p[b*2]!-=dx*k*wb;p[b*2+1]!-=dy*k*wb
}

export function stepLampCord(cord:LampCord,x:number,y:number,dt:number,still=false){
  if(!cord.initialized){cord.initialized=true;cord.anchorX=x;cord.endX=x;cord.endY=y;reset(cord,x,y)}
  const dx=x-cord.endX,dy=y-cord.endY
  // A resize or a discrete keyboard/test jump must not inject unbounded energy.
  if(still||Math.hypot(dx,dy)>100){reset(cord,x,y);cord.endX=x;cord.endY=y;return}
  const elapsed=Math.min(.05,Math.max(0,dt)),steps=Math.floor((cord.remainder+elapsed)/STEP)
  cord.remainder+=elapsed-steps*STEP
  for(let step=0;step<steps;step++){
    const t=(step+1)/steps,endX=cord.endX+dx*t,endY=cord.endY+dy*t
    const distance=Math.hypot(endX-cord.anchorX,endY+100)
    // The hidden ceiling feed pays out cord as the user changes its reach.
    const length=(distance+Math.min(12,distance*.008))/(CORD_POINTS-1)
    const attenuation=Math.exp(-DAMPING*STEP)
    for(let i=1;i<CORD_POINTS-1;i++){
      const k=i*2,px=cord.points[k]!,py=cord.points[k+1]!
      cord.points[k]=px+(px-cord.previous[k]!)*attenuation
      cord.points[k+1]=py+(py-cord.previous[k+1]!)*attenuation+GRAVITY*STEP*STEP
      cord.previous[k]=px;cord.previous[k+1]=py
    }
    for(let iteration=0;iteration<ITERATIONS;iteration++){
      pin(cord,endX,endY)
      if(iteration%2===0)for(let i=0;i<CORD_POINTS-1;i++)segment(cord,i,i+1,length)
      else for(let i=CORD_POINTS-2;i>=0;i--)segment(cord,i,i+1,length)
      // A fabric-covered electrical cord resists an abrupt kink.
      for(let i=1;i<CORD_POINTS-1;i++){
        const k=i*2
        cord.points[k]!+=((cord.points[k-2]!+cord.points[k+2]!)*.5-cord.points[k]!)*.025
        cord.points[k+1]!+=((cord.points[k-1]!+cord.points[k+3]!)*.5-cord.points[k+1]!)*.025
      }
    }
    pin(cord,endX,endY)
  }
  pin(cord,x,y);cord.endX=x;cord.endY=y
}
