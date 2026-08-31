// ROADMAP R11 — validates the JS-side ASC-CDL SOP math (mirrors cdlComputeSOP/_wheelRGB in
// chromasmith-22.html) BEFORE any GLSL was written, per CLAUDE.md's "port real math, verify
// in Node first" rule (see R2's AgX port / R6's Richardson-Lucy for precedent).
//
// ASC-CDL (American Society of Cinematographers Color Decision List), the published formula
// behind DaVinci Resolve's primary wheels and OpenColorIO's CDLTransform:
//     out = clamp( (in * slope + offset) ^ power , 0, 1 )   per channel

function wheelRGB(h,s){
  const rad=h*Math.PI/180,x=s*Math.cos(rad),y=s*Math.sin(rad),k=0.4;
  return[0,120,240].map(deg=>{const a=deg*Math.PI/180;return k*(x*Math.cos(a)+y*Math.sin(a));});
}
function computeSOP(W){
  const liftRGB=wheelRGB(W.lift.h,W.lift.s), gainRGB=wheelRGB(W.gain.h,W.gain.s), gammaRGB=wheelRGB(W.gamma.h,W.gamma.s);
  const offset=[0,1,2].map(i=>liftRGB[i]+(W.lift.l/100)*0.25);
  const slope=[0,1,2].map(i=>1+gainRGB[i]+(W.gain.l/100)*1.0);
  const gammaVal=[0,1,2].map(i=>Math.max(0.05,1+gammaRGB[i]+(W.gamma.l/100)*1.0));
  const power=gammaVal.map(g=>1/g);
  return{slope,offset,power};
}
function applyCDL(rgb,sop){
  return rgb.map((c,i)=>{
    const base=Math.max(c*sop.slope[i]+sop.offset[i],0);
    return Math.min(1,Math.max(0,Math.pow(base,sop.power[i])));
  });
}
const neutralW={lift:{h:0,s:0,l:0},gamma:{h:0,s:0,l:0},gain:{h:0,s:0,l:0}};

// 1) Neutral wheels -> slope=1,offset=0,power=1 exactly (bit-for-bit ASC CDL identity).
const sopN=computeSOP(neutralW);
console.log('neutral SOP:',sopN);
console.log('neutral is exact identity:',sopN.slope.every(v=>v===1)&&sopN.offset.every(v=>v===0)&&sopN.power.every(v=>v===1));

// 2) Neutral wheels round-trip a set of test pixels exactly (no-op through the real formula).
const testPixels=[[0,0,0],[1,1,1],[0.5,0.5,0.5],[0.2,0.6,0.9],[0.83,0.11,0.47]];
let maxErr=0;
for(const px of testPixels){const out=applyCDL(px,sopN);
  maxErr=Math.max(maxErr,...px.map((v,i)=>Math.abs(v-out[i])));}
console.log('neutral round-trip max abs error:',maxErr);

// 3) A known, hand-computed lift/gamma/gain triple applied to a known input, verified by hand
//    against the literal ASC-CDL formula (not the app's code — an independent hand computation).
//    slope=[1.2,1.0,0.9], offset=[0.05,0.0,-0.03], power=[0.9,1.0,1.1], in=[0.5,0.5,0.5]
const handSOP={slope:[1.2,1.0,0.9],offset:[0.05,0.0,-0.03],power:[0.9,1.0,1.1]};
const handIn=[0.5,0.5,0.5];
// R: (0.5*1.2+0.05)^0.9 = (0.65)^0.9
// G: (0.5*1.0+0.0)^1.0  = 0.5
// B: max(0.5*0.9-0.03,0)^1.1 = (0.42)^1.1
const expected=[Math.pow(0.65,0.9),0.5,Math.pow(0.42,1.1)];
const got=applyCDL(handIn,handSOP);
console.log('hand SOP expected:',expected);
console.log('hand SOP got     :',got);
console.log('hand SOP max abs error:',Math.max(...expected.map((v,i)=>Math.abs(v-got[i]))));

// 4) Wheel -> SOP -> CDL, one concrete non-neutral case with a hand-solvable wheel angle:
//    Gain wheel dragged to full radius at 0° (pure R primary), lift/gamma neutral.
//    _wheelRGB(0,1) with k=0.4 projects (x=1,y=0) onto R(0°)->k*1=0.4, G(120°)->k*cos(120°)=-0.2,
//    B(240°)->k*cos(240°)=-0.2 (cos(120)=cos(240)=-0.5). So slope should be [1.4,0.8,0.8].
const gainOnlyW={lift:{h:0,s:0,l:0},gamma:{h:0,s:0,l:0},gain:{h:0,s:1,l:0}};
const sopGain=computeSOP(gainOnlyW);
console.log('gain-wheel-at-0deg-full-radius slope (expect [1.4,0.8,0.8]):',sopGain.slope);

const okNeutral=sopN.slope.every(v=>v===1)&&sopN.offset.every(v=>v===0)&&sopN.power.every(v=>v===1)&&maxErr<1e-12;
const okHand=Math.max(...expected.map((v,i)=>Math.abs(v-got[i])))<1e-12;
const okGain=Math.abs(sopGain.slope[0]-1.4)<1e-9&&Math.abs(sopGain.slope[1]-0.8)<1e-9&&Math.abs(sopGain.slope[2]-0.8)<1e-9;
console.log('ALL CHECKS PASS:',okNeutral&&okHand&&okGain);
