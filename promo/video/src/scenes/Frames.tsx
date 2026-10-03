import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C,p,mix} from '../theme';
import {Full,Box,Photo,Type,Sound} from '../shared';
export const Frames:React.FC=()=>{
 const f=useCurrentFrame(),enter=p(f,0,27),b=32;
 return <Full>
  <Box x={420} y={112} w={1096} h={760}><Photo src="flowers.webp" style={{scale:1.05,clipPath:`inset(${mix(50,0,enter)}% 0)`}}/></Box>
  <Box x={420} y={112} w={1096} h={760}>
   <div style={{position:'absolute',right:0,top:0,width:b,height:760*p(f,27,30),background:C.paper}}/>
   <div style={{position:'absolute',right:0,bottom:0,height:b,width:1096*p(f,57,30),background:C.paper}}/>
   <div style={{position:'absolute',left:0,bottom:0,width:b,height:760*p(f,87,30),background:C.paper}}/>
   <div style={{position:'absolute',left:0,top:0,height:b,width:1096*p(f,117,30),background:C.paper}}/>
  </Box>
  <Type x={96} y={928} size={102}>Give it a frame.</Type>
  <Type x={103} y={176} size={52} w={260} weight={400} style={{lineHeight:1.08}}>The<br/>finishing<br/>touch.</Type>
  {[27,57,87,117].map(t=><Sound key={t} src="sfx/tactile.wav" at={t} volume={.18}/>)}
 </Full>;
};
