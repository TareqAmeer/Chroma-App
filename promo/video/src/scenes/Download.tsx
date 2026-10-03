import React from 'react';
import {Img,staticFile,useCurrentFrame} from 'remotion';
import {C,p,mix} from '../theme';
import {Full,Type,Box} from '../shared';
export const Download:React.FC=()=>{
 const f=useCurrentFrame(),lock=p(f,78,30);
 return <Full>
  <Box x={1160} y={0} w={760} h={1080} style={{background:C.bg}}>
   <div style={{position:'absolute',left:223,top:383,width:144,height:132,background:C.paper,clipPath:`inset(0 0 ${100-100*p(f,20,45)}% 0)`}}/>
   <Img src={staticFile('img/chromasmith-logo-dark.svg')} style={{position:'absolute',left:160,top:320,width:300,height:300,opacity:lock}}/>
   <Type x={66} y={720} size={66} color={C.paper} weight={400} w={630}>Mac · Windows</Type>
   <Type x={66} y={818} size={46} color={C.paper} weight={400}>No subscription.</Type>
   <Type x={66} y={963} size={30} color={C.paper} weight={400}>tareqameer.github.io/Chroma-App</Type>
  </Box>
  <Type x={96} y={112} size={146} w={1000}>Film feeling.<br/>Less fuss.</Type>
  <Type x={96} y={553} size={138} color={C.acc} w={1000}>Download<br/>free.</Type>
  <Type x={96} y={933} size={108}>Chromasmith</Type>
 </Full>;
};
