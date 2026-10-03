import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C,p,mix} from '../theme';
import {Full,Box,Photo,Type,Rule,Sound} from '../shared';
export const Hero:React.FC=()=>{
 const f=useCurrentFrame(),a=p(f,26,124),r=p(f,30,60);
 return <Full>
  <Box x={mix(704,624,r)} y={80} w={mix(1120,1200,r)} h={760}><Photo src="car.webp" style={{scale:mix(1.12,1,r)}}/></Box>
  <Type x={96} y={142} size={154} w={560}>Film<br/>feeling.</Type>
  <Type x={101} y={524} size={58} weight={400} w={460} style={{lineHeight:1.12}}>For your<br/>photographs.</Type>
  <Rule x={96} y={974} w={1728} color={C.mid}/><Rule x={96} y={974} w={1620*a} color={C.acc}/>
  <Sound src="sfx/tactile.wav" at={26} volume={.22}/>
 </Full>;
};
