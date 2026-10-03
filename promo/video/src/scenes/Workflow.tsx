import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C,p,mix} from '../theme';
import {Full,Box,Photo,Type,Sound} from '../shared';
export const Workflow:React.FC=()=>{
 const f=useCurrentFrame(),press=p(f,135,20);
 return <Full>
  <Box x={96} y={80} w={640} h={850}><Photo src="hill.webp" fit="contain" style={{scale:mix(1,1.03,press)}}/></Box>
  <Type x={835} y={136} size={145}>One app.<br/>One export.</Type>
  <Type x={843} y={505} size={68} weight={400} w={900} style={{lineHeight:1.08}}>Less work.<br/>More film.</Type>
  <Box x={840} y={780} w={930} h={144} style={{background:press>.95?C.bg:C.acc}}><Type x={42} y={28} size={84} color={C.paper}>{press>.95?'Ready.':'Export'}</Type></Box>
  <Type x={842} y={970} size={44} weight={400}>At full resolution.</Type>
  <Sound src="sfx/export.wav" at={145} volume={.32}/>
 </Full>;
};
