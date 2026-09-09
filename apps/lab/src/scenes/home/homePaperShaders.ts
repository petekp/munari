// Curved-paper visibility — a fitted depth map with a finite-source penumbra.
// Receiver-plane correction prevents the sheet shadowing itself merely because
// a filter tap lands farther down its slope. Real curls can still occlude it (#51).

const taps=Array.from({length:64},(_,i)=>{
  const angle=i*2.399963229728653,radius=Math.sqrt((i+.5)/64)
  return `vec2(${(Math.cos(angle)*radius).toFixed(8)},${(Math.sin(angle)*radius).toFixed(8)})`
}).join(',\n')

export const PAPER_LIGHT_GLSL=/* glsl */`
uniform sampler2D uPaperShadow;
uniform mat4 uPaperShadowMatrix;
uniform vec2 uPaperShadowRange;
uniform float uPaperReady;
uniform vec2 uFrameOrigin;

const vec2 LIGHT_TAPS[64]=vec2[64](${taps});
// The bulb subtends a cone around each receiver-to-light ray. A disk parallel
// to the page kept long, grazing shadows as sharp as nearby shadows (#50).
mat3 bulbBasis(vec3 delta){
  vec3 direction=normalize(delta);
  vec3 tangent=length(direction.xy)>.001 ? normalize(vec3(-direction.y,direction.x,0.0)) : vec3(1.0,0.0,0.0);
  return mat3(tangent,cross(direction,tangent),direction);
}
float bulbCosine(vec3 delta){return sqrt(max(.001,1.0-uLightRadius*uLightRadius/dot(delta,delta)));}
vec3 sampleBulbRay(mat3 basis,float cosineLimit,vec2 samplePoint){
  float radiusSquared=dot(samplePoint,samplePoint);
  float cosine=mix(1.0,cosineLimit,radiusSquared);
  float scale=sqrt(max(0.0,1.0-cosine*cosine)/max(radiusSquared,.00001));
  return basis*vec3(samplePoint*scale,cosine);
}
vec2 paperDepth(vec2 uv){
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return vec2(4096.0,0.0);
  vec2 sampleValue=texture2D(uPaperShadow,uv).rg;
  return sampleValue.y>0.001 ? vec2(sampleValue.x/sampleValue.y,sampleValue.y) : vec2(4096.0,0.0);
}
float paperVisibility(vec3 receiver,vec3 normal,vec3 light){
  vec3 p=receiver+normal*.65;
  p.xy+=uFrameOrigin;
  vec4 projected=uPaperShadowMatrix*vec4(p,1.0);
  vec2 uv=projected.xy/projected.w*.5+.5;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return 1.0;
  float depth=max(1.0,light.z-p.z);
  vec3 delta=vec3(light.xy+uFrameOrigin,light.z)-p;
  mat3 basis=bulbBasis(delta);
  float cosineLimit=bulbCosine(delta);
  vec2 q=(p.xy-light.xy-uFrameOrigin)/depth;
  float slope=dot(normal,vec3(q,-1.0));
  slope=(slope<0.0 ? -1.0 : 1.0)*max(abs(slope),.05);
  vec2 gradient=clamp(-depth*normal.xy/slope*uPaperShadowRange,vec2(-4096.0),vec2(4096.0));
  float blocker=0.0,count=0.0;
  vec2 center=paperDepth(uv);
  if(center.x<depth-.6){blocker=center.x*center.y;count=center.y;}
  for(int i=0;i<8;i++){
    vec3 ray=sampleBulbRay(basis,cosineLimit,LIGHT_TAPS[i*9]);
    vec3 searchPoint=p+ray*(depth*.5/max(ray.z,.0001));
    vec4 searchClip=uPaperShadowMatrix*vec4(searchPoint,1.0);
    vec2 offset=searchClip.xy/searchClip.w*.5+.5-uv;
    vec2 sampleDepth=paperDepth(uv+offset);
    if(sampleDepth.x<depth+dot(gradient,offset)-.6){blocker+=sampleDepth.x*sampleDepth.y;count+=sampleDepth.y;}
  }
  if(count==0.0)return 1.0;
  blocker/=count;
  float visible=0.0;
  for(int i=0;i<64;i++){
    vec3 ray=sampleBulbRay(basis,cosineLimit,LIGHT_TAPS[i]);
    vec3 blockerPoint=p+ray*(max(0.0,depth-blocker)/max(ray.z,.0001));
    vec4 blockerClip=uPaperShadowMatrix*vec4(blockerPoint,1.0);
    vec2 offset=blockerClip.xy/blockerClip.w*.5+.5-uv;
    if(length(offset)<1.0/1024.0)offset=LIGHT_TAPS[i]/1024.0;
    vec2 sampleDepth=paperDepth(uv+offset);
    visible+=1.0-sampleDepth.y*(1.0-step(depth+dot(gradient,offset)-.6,sampleDepth.x));
  }
  return visible/64.0;
}
`
