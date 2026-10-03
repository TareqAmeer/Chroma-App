import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C,p,mix} from '../theme';
import {Full,Box,Type,Rule,Wipe,Sound} from '../shared';
export const Texture:React.FC=()=>{
 const f=useCurrentFrame(),a=p(f,72,138);
 return <Full bg={C.bg}>
  <Type x={96} y={86} size={206} color={C.paper}>Grain.</Type>
  <Type x={104} y={316} size={88} color={C.paper} weight={400}>Feel the detail.</Type>
  <Box x={1190} y={80} w={570} h={760}>
   <Wipe before="canal-look.webp" after="canal-film.webp" amount={a} zoom={mix(2.6,1,p(f,220,55))} focal="48% 65%"/>
   <div style={{position:'absolute',left:18,top:18,padding:'9px 14px',background:C.paper,color:C.bg,fontSize:34,fontWeight:700}}>{a<.98?'Before → After':'Film texture applied'}</div>
  </Box>
  {Array.from({length:288},(_,i)=>{
   const col=i%24,row=Math.floor(i/24),seed=(i*37%101)/101;
   const appear=p(f,14+col*1.5+row*.5,26),t=p(f,115+col*2+row*.4,80);
   const size=mix(3,8+seed*14,a)*appear;
   return <React.Fragment key={i}><div style={{position:'absolute',left:104+col*40,top:483+row*31,width:size,height:size,background:i%19===0?C.acc:C.paper,opacity:.55*t}}/><div style={{position:'absolute',left:mix(104+col*40,1220+col*20,t),top:mix(483+row*31,238+row*35,t),width:mix(size,1.1,t),height:mix(size,1.1,t),background:i%19===0?C.acc:C.paper,opacity:1-t,transform:`rotate(${mix(-18,0,appear)}deg)`}}/></React.Fragment>;
  })}
  <Type x={104} y={856} size={54} color={C.paper} weight={400}>Grain amount</Type>
  <Type x={1700} y={866} size={54} color={C.paper} style={{textAlign:'right'}}>{Math.round(8*a)}</Type>
  <Rule x={840} y={973} w={960} color={C.dim}/><Rule x={840} y={973} w={900*a} color={C.acc}/>
  <Sound src="sfx/granules.wav" at={65} volume={.25}/><Sound src="sfx/tactile.wav" at={210} volume={.25}/>
 </Full>;
};
