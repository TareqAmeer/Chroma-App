import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C,p,mix} from '../theme';
import {Full,Box,Photo,Type,Sound} from '../shared';
export const Studio:React.FC=()=>{
 const f=useCurrentFrame(),a=p(f,0,22);
 return <Full bg={C.bg}>
  <Box x={96} y={mix(1150,92,a)} w={1728} h={960}><Photo src="studio-4.webp" fit="contain"/></Box>
  <Box x={96} y={80} w={1100} h={175} style={{background:C.bg}}><Type x={0} y={16} size={92} color={C.paper}>Meet Chromasmith.</Type></Box>
  <Box x={96} y={930} w={1160} h={110} style={{background:C.bg}}><Type x={0} y={12} size={56} color={C.paper} weight={400}>Your desktop film lab.</Type></Box>
  <Sound src="sfx/rail.wav" at={1} volume={.24}/><Sound src="sfx/tactile.wav" at={65} volume={.3}/>
 </Full>;
};
