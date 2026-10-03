import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C,p,mix} from './theme';
type Pose={x:number;y:number;s:number;rot:number;color:string;opacity:number;h?:number};
const start:Pose={x:130,y:918,s:112,rot:0,color:C.acc,opacity:1};
const lerp=(a:Pose,b:Partial<Pose>,t:number):Pose=>({...a,...b,x:mix(a.x,b.x??a.x,t),y:mix(a.y,b.y??a.y,t),s:mix(a.s,b.s??a.s,t),rot:mix(a.rot,b.rot??a.rot,t),h:mix(a.h??a.s,b.h??b.s??a.h??a.s,t),opacity:mix(a.opacity,b.opacity??a.opacity,t)});
export const pose=(f:number):Pose=>{
 let a={...start};
 const moves:[number,number,Partial<Pose>,string][]=[
 [10,26,{rot:-12},'lean'],[26,150,{x:1710,rot:1260},'roll'],[150,165,{rot:1260},'settle'],
 [180,220,{x:1670,y:560,s:48,h:84,rot:1800},'arc'],
 [220,254,{x:980,y:265,s:420,h:76,rot:1800},'arc'],
 [278,316,{x:980,y:645,s:460,h:420,rot:1800},'arc'],
 [328,354,{x:1518,y:834,s:20,h:20,rot:1980,color:C.paper},'arc'],
 [472,530,{x:130,y:936,s:64,rot:2160,color:C.acc},'arc'],
 [550,720,{x:1750,rot:4410},'roll'],
 [780,834,{x:840,y:949,s:48,rot:4590},'arc'],
 [852,990,{x:1740,rot:6300},'roll'],
 [1080,1107,{x:1516,y:112,s:32,rot:6480},'arc'],
 [1107,1137,{x:1516,y:872,s:32,h:124,rot:6480},'edge'],
 [1137,1167,{x:420,y:872,s:124,h:32,rot:6480},'edge'],
 [1167,1197,{x:420,y:112,s:32,h:124,rot:6480},'edge'],
 [1197,1227,{x:1516,y:112,s:124,h:32,rot:6480},'edge'],
 [1227,1250,{s:32,h:32},'settle'],
 [1305,1360,{x:1690,y:852,s:64,rot:7020},'arc'],
 [1430,1455,{s:52,rot:7012},'lean'],[1455,1470,{s:64,rot:7020},'settle'],
 [1530,1608,{x:1492.5,y:483.5,s:129,h:135,rot:7380},'arc'],
 [1608,1638,{opacity:0},'settle']
 ];
 for(const [from,to,b,kind] of moves){
  if(f<from)break;
  const t=p(f,from,to-from),v=lerp(a,b,t);
  if(kind==='arc')v.y-=Math.sin(t*Math.PI)*170;
  if(kind==='roll'){
   const q=(v.rot-a.rot)/90,phase=q-Math.floor(q);
   v.y-=v.s/2*(Math.cos(phase*Math.PI/2)+Math.sin(phase*Math.PI/2)-1);
  }
  if(f<to)return v;
  a=lerp(a,b,1);
 }
 return a;
};
export const Square:React.FC<{offset?:number}>=({offset=0})=>{
 const f=useCurrentFrame()+offset,a=pose(f),stretch=1+.09*Math.sin(f*.35)*(f>180&&f<220?1:0),isFrame=f>=286&&f<338;
 const flight=(f>=180&&f<220)||(f>=328&&f<354)||(f>=1530&&f<1608);
 const sx=flight?1+.15*Math.sin((f%30)/30*Math.PI):1;
 return <div data-square-character style={{position:'absolute',zIndex:20,left:a.x-a.s/2,top:a.y-(a.h??a.s)/2,width:a.s,height:(a.h??a.s)*stretch,background:isFrame?'transparent':a.color,border:isFrame?`7px solid ${a.color}`:undefined,boxSizing:'border-box',transform:`rotate(${a.rot}deg) scale(${sx},${1/sx})`,opacity:a.opacity}}/>;
};
