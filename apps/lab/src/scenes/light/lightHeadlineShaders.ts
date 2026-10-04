// Headline shader — thin-film colour follows a rippled surface and the page lamp.
// Glyph coverage stays independent of the animated material, preserving sharp type.
export const HEADLINE_VERTEX=/* glsl */`
varying vec2 vUv;
varying vec3 vPosition;
void main(){vUv=uv;vPosition=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vPosition,1.0);}
`

export const HEADLINE_FRAGMENT=/* glsl */`
uniform sampler2D uInk;
uniform vec3 uLight;
uniform float uTime;
uniform float uAspect;
uniform vec2 uPointer;
uniform float uRippleAge;
varying vec2 vUv;
varying vec3 vPosition;
void main(){
  float alpha=texture2D(uInk,vUv).a;
  if(alpha<.002)discard;
  vec2 p=(vUv-.5)*vec2(uAspect,1.0);
  float a=p.x*3.2+p.y*4.0+uTime;
  float b=p.y*7.0-p.x*1.7-uTime*.65;
  vec2 offset=(vUv-uPointer)*vec2(uAspect,1.0);
  float radius=length(offset);
  float ring=exp(-uRippleAge*.9-abs(radius-uRippleAge*.65)*4.0);
  vec2 ripple=offset/max(radius,.001)*cos(radius*20.0-uRippleAge*9.0)*ring;
  vec3 normal=normalize(vec3(vec2(-.32*cos(a)+.11*cos(b),-.40*cos(a)-.42*cos(b))+ripple,1.0));
  vec3 light=normalize(uLight-vPosition);
  float film=sin(a)*1.4+sin(b)*.7+dot(normal,light)*5.0;
  vec3 colour=.5+.5*cos(film+vec3(.0,2.1,4.2));
  colour=mix(vec3(.035,.009,.065),colour*.48,.76);
  float specular=pow(max(dot(normal,normalize(light+vec3(0.0,0.0,1.0))),0.0),36.0);
  colour+=vec3(.65,.72,.85)*specular*.7;
  gl_FragColor=vec4(colour,alpha);
  #include <colorspace_fragment>
  gl_FragColor.rgb*=alpha;
}
`
