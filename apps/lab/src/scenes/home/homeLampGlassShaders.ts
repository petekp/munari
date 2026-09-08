// Lamp glass — a displaced hollow SDF shell with four optical interfaces.
// Native page colour is refracted through the shell; a hot coil emits inside it.
// Reflection-only fallback keeps the lamp usable without HTML capture (#52).

// The capture arrays and shader declarations use the same layer limit.
export const LAMP_CANVAS_LAYERS=4

export const LAMP_GLASS_VERTEX=/* glsl */`
varying vec3 vLocal;
void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`

export const LAMP_GLASS_FRAGMENT=/* glsl */`
uniform vec3 uEye;
uniform mat4 uMvp;
uniform vec4 uLampViewport;
uniform float uPixelWidth;
uniform float uLightDistance;
uniform float uIor;
uniform float uDispersion;
uniform float uDisplacement;
uniform float uEmission;
uniform float uPageReady;
uniform vec2 uViewport;
uniform sampler2D uPage;
uniform sampler2D uPageLight;
uniform vec4 uPageLightRect;
uniform sampler2D uLayers[${LAMP_CANVAS_LAYERS}];
uniform vec4 uLayerRects[${LAMP_CANVAS_LAYERS}];
uniform int uLayerCount;
varying vec3 vLocal;

float ellipsoid(vec3 p,vec3 r){float a=length(p/r),b=length(p/(r*r));return a*(a-1.0)/max(b,.00001);}
float smoothUnion(float a,float b,float k){float h=max(k-abs(a-b),0.0)/k;return min(a,b)-h*h*k*.25;}
float glassDistance(vec3 p){
  float body=ellipsoid(p-vec3(0.0,-3.0,0.0),vec3(29.5,30.5,29.5));
  float neck=ellipsoid(p-vec3(0.0,25.5,0.0),vec3(9.0,17.0,9.0));
  float wave=sin(p.y*.23+sin(p.x*.11))*sin(p.z*.19)+.35*sin(dot(p,vec3(.14,.09,.21)));
  return smoothUnion(body,neck,8.0)+wave*uDisplacement;
}
vec3 glassNormal(vec3 p){
  vec2 e=vec2(.045,0.0);
  return normalize(vec3(glassDistance(p+e.xyy)-glassDistance(p-e.xyy),glassDistance(p+e.yxy)-glassDistance(p-e.yxy),glassDistance(p+e.yyx)-glassDistance(p-e.yyx)));
}
float fresnel(vec3 ray,vec3 normal,float from,float into){
  float c=clamp(-dot(ray,normal),0.0,1.0),eta=from/into,s=eta*eta*(1.0-c*c);
  if(s>=1.0)return 1.0;
  float t=sqrt(1.0-s),rs=(from*c-into*t)/max(.00001,from*c+into*t),rp=(into*c-from*t)/max(.00001,into*c+from*t);
  return (rs*rs+rp*rp)*.5;
}
vec3 studio(vec3 ray){
  vec3 colour=mix(vec3(.012,.017,.022),vec3(.12,.14,.17),smoothstep(-.7,.8,ray.y));
  vec2 left=vec2(dot(ray,normalize(vec3(.88,0.0,.47))),ray.y);
  float strip=exp(-pow(abs(left.x+.17)/.08,6.0))*smoothstep(-.6,-.35,left.y)*(1.0-smoothstep(.6,.85,left.y));
  float top=pow(max(dot(ray,normalize(vec3(.25,.8,.55))),0.0),80.0);
  float side=pow(max(dot(ray,normalize(vec3(.75,.12,.65))),0.0),150.0);
  return colour+vec3(5.0,5.8,7.0)*strip+vec3(9.0,7.5,5.2)*top+vec3(2.0,2.3,2.8)*side;
}
vec3 srgbToLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec4 layerPixel(sampler2D image,vec4 rect,vec2 p){
  vec2 uv=(p-rect.xy)/rect.zw;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return vec4(0.0);
  return texture2D(image,uv);
}
vec3 backdrop(vec2 uv){
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return srgbToLinear(vec3(.894,.925,.23));
  vec2 p=uv*uViewport;
  vec3 colour=texture2D(uPage,uv).rgb;
  ${Array.from({length:LAMP_CANVAS_LAYERS},(_,i)=>`if(uLayerCount>${i}){vec4 layer=layerPixel(uLayers[${i}],uLayerRects[${i}],p);colour=layer.rgb+colour*(1.0-layer.a);}`).join('\n')}
  if(uPageLightRect.z>0.0)colour*=layerPixel(uPageLight,uPageLightRect,p).rgb;
  return srgbToLinear(colour);
}
vec3 backgroundAlong(vec3 p,vec3 ray){
  if(ray.z>=-.002)return studio(ray)*.1;
  p+=ray*((-uLightDistance-p.z)/ray.z);
  vec4 clip=uMvp*vec4(p,1.0);
  vec2 pixel=(clip.xy/clip.w*.5+.5)*uLampViewport.zw+uLampViewport.xy;
  return backdrop(pixel/uViewport);
}

// Walk the wall to the next interface. 1 reaches the cavity; 0 exits outside.
float crossWall(inout vec3 p,vec3 ray){
  for(int i=0;i<48;i++){
    float outer=glassDistance(p),inner=outer+1.15;
    if(inner<.004)return 1.0;
    if(outer>-.004)return 0.0;
    p+=ray*max(.008,min(-outer,inner)*.78);
  }
  return -1.0;
}
bool crossCavity(inout vec3 p,vec3 ray){
  for(int i=0;i<64;i++){
    float distance=-(glassDistance(p)+1.15);
    if(distance<.004)return true;
    p+=ray*max(.012,distance*.8);
  }
  return false;
}
float raySegment(vec3 p,vec3 ray,float reach,vec3 a,vec3 b){
  vec3 edge=b-a,w=p-a;
  float lengthSquared=dot(edge,edge),along=dot(ray,edge),denominator=max(.0001,lengthSquared-along*along);
  float t=clamp((dot(edge,w)-along*dot(ray,w))/denominator,0.0,1.0);
  float s=clamp(dot(a+edge*t-p,ray),0.0,reach);
  t=clamp(dot(p+ray*s-a,edge)/lengthSquared,0.0,1.0);
  return length(p+ray*s-a-edge*t);
}
vec3 coilPoint(float t){return vec3(-11.0+22.0*t,-8.0+4.0*sin(t*3.14159265)+.85*cos(t*62.831853),.85*sin(t*62.831853));}
vec3 filament(vec3 p,vec3 ray,float reach,out float leads){
  float distance=1000.0;
  vec3 a=coilPoint(0.0);
  for(int i=1;i<=48;i++){vec3 b=coilPoint(float(i)/48.0);distance=min(distance,raySegment(p,ray,reach,a,b));a=b;}
  float wire=1.0-smoothstep(.16,.16+uPixelWidth*.8,distance);
  float halo=exp(-distance*distance/3.2)+.045*exp(-distance*distance/40.0);
  float lead=min(raySegment(p,ray,reach,vec3(-11.0,19.0,0.0),coilPoint(0.0)),raySegment(p,ray,reach,vec3(11.0,19.0,0.0),coilPoint(1.0)));
  leads=1.0-smoothstep(.17,.17+uPixelWidth*.7,lead);
  return uEmission*(vec3(22.0,12.0,4.5)*wire+vec3(2.4,.9,.16)*halo);
}
vec3 refractedChain(vec3 ray,vec3 n0,vec3 n1,vec3 n2,vec3 n3,float ior,bool cavity){
  ray=refract(ray,n0,1.0/ior);ray=refract(ray,n1,ior);
  if(length(ray)<.1)return vec3(0.0);
  if(cavity){ray=refract(ray,n2,1.0/ior);ray=refract(ray,n3,ior);}
  return ray;
}

void main(){
  vec3 ray=normalize(vLocal-uEye),offset=uEye-vec3(0.0,6.0,0.0);
  float b=dot(offset,ray),disc=b*b-dot(offset,offset)+48.0*48.0;
  if(disc<0.0)discard;
  float start=max(0.0,-b-sqrt(disc)),end=-b+sqrt(disc),travel=start,closest=1000.0;
  vec3 p=uEye+ray*start,nearest=p;
  bool hit=false;
  for(int i=0;i<80;i++){
    p=uEye+ray*travel;float distance=glassDistance(p);
    if(distance<closest){closest=distance;nearest=p;}
    if(distance<.004){hit=true;break;}
    travel+=max(.008,distance*.74);if(travel>end)break;
  }
  p=hit?p:nearest;
  // A hit says only that the pixel centre is inside. Estimate the ray's signed
  // minimum to retain partial coverage on both sides of the implicit edge.
  float d=glassDistance(p),before=glassDistance(p-ray*.5),after=glassDistance(p+ray*.5);
  float slope=after-before,curvature=(after+before-2.0*d)*4.0;
  float minimum=hit ? -2.0*uPixelWidth : closest;
  if(curvature>.0001&&abs(slope)<.5)minimum=max(d-slope*slope/(2.0*curvature),-2.0*uPixelWidth);
  float pixelWidth=max(fwidth(minimum),uPixelWidth*.25);
  float coverage=clamp(.5-minimum/pixelWidth,0.0,1.0);
  if(coverage<.005)discard;
  vec3 front=p,n0=glassNormal(front),n1=n0,n2=n0,n3=n0;
  vec3 emission=vec3(0.0),exitRay=ray;
  float leads=0.0,wallLength=0.0,reflection=fresnel(ray,n0,1.0,uIor),transmission=1.0-reflection;
  bool cavity=false,transmitted=false;
  if(hit){
    vec3 inGlass=refract(ray,n0,1.0/uIor);p+=inGlass*.015-n0*.01;
    float boundary=crossWall(p,inGlass);wallLength=length(p-front);
    if(boundary>.5){
      n1=glassNormal(p);vec3 inAir=refract(inGlass,n1,uIor);
      transmission*=1.0-fresnel(inGlass,n1,uIor,1.0);
      if(length(inAir)>.1){
        vec3 airStart=p+inAir*.015-n1*.01;p=airStart;
        if(crossCavity(p,inAir)){
          emission=filament(airStart,inAir,length(p-airStart),leads);
          n2=-glassNormal(p);vec3 backGlass=refract(inAir,n2,1.0/uIor),backStart=p;
          transmission*=1.0-fresnel(inAir,n2,1.0,uIor);
          p+=backGlass*.015-n2*.01;
          if(crossWall(p,backGlass)==0.0){
            n3=-glassNormal(p);exitRay=refract(backGlass,n3,uIor);
            transmission*=1.0-fresnel(backGlass,n3,uIor,1.0);
            wallLength+=length(p-backStart);cavity=true;transmitted=length(exitRay)>.1;
          }
        }
      }
    }else if(boundary>-.5){n1=-glassNormal(p);exitRay=refract(inGlass,n1,uIor);transmission*=1.0-fresnel(inGlass,n1,uIor,1.0);transmitted=length(exitRay)>.1;}
  }
  if(!transmitted)reflection=1.0;
  else reflection=1.0-transmission;
  vec3 colour=vec3(.02,.022,.024);
  if(transmitted&&uPageReady>.5){
    vec3 red=refractedChain(ray,n0,n1,n2,n3,uIor-uDispersion,cavity);
    vec3 blue=refractedChain(ray,n0,n1,n2,n3,uIor+uDispersion,cavity);
    colour=vec3(backgroundAlong(p,red).r,backgroundAlong(p,exitRay).g,backgroundAlong(p,blue).b);
  }
  vec3 absorption=exp(-vec3(.0008,.0018,.004)*wallLength);
  colour*=absorption*(1.0-reflection)*(1.0-leads*.7);
  vec3 radiance=studio(reflect(ray,n0))*reflection+emission*absorption;
  // A little filament light scatters through the shell and lights its rim.
  float internalGlow=uEmission/(1.0+dot(front-vec3(0.0,-7.0,0.0),front-vec3(0.0,-7.0,0.0))/400.0);
  radiance+=vec3(.5,.3,.12)*internalGlow*(.2+reflection*.8);
  colour=1.0-(1.0-colour)*exp(-radiance);
  float alpha=coverage;
  if(uPageReady<.5)alpha*=clamp(reflection+dot(emission,vec3(.22,.7,.08))*.6+.025,0.0,1.0);
  vec4 clip=uMvp*vec4(front,1.0);gl_FragDepth=clip.z/clip.w*.5+.5;
  gl_FragColor=vec4(max(colour,0.0),alpha);
  #include <colorspace_fragment>
  gl_FragColor.rgb*=gl_FragColor.a;
}
`
