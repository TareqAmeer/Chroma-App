import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C,p,mix} from '../theme';
import {Full,Box,Type,Rule,Wipe,Sound} from '../shared';
export const Looks:React.FC=()=>{
 const f=useCurrentFrame(),a=p(f,40,170);
 const colours=['#24231f','#8b877e','#c9c5bb','#f2efe8','#ff3b1f','#0b0b0a'];
 return <Full>
  <Type x={96} y={54} size={116}>Find your colour.</Type>
  <Box x={96} y={226} w={1728} h={640}>
   <Wipe before="main1-1600.webp" after="main5-1600.webp" amount={a}/>
   {colours.map((colour,i)=>{
    const t=p(f,26+i*5,72);
    return <div key={i} style={{position:'absolute',left:i*288,top:0,width:288,height:mix(640,0,t),background:colour,transformOrigin:'top',borderRight:`1px solid ${C.paper}`}}/>;
   })}
   {f>95&&<div style={{position:'absolute',left:26,top:24,background:C.paper,padding:'10px 18px',fontSize:40,fontWeight:700}}>{a<.98?'Before → After':'Film look applied'}</div>}
  </Box>
  <Type x={96} y={905} size={48} weight={400}>133 film looks.</Type>
  <Rule x={96} y={970} w={1728} color={C.mid}/><Rule x={96} y={970} w={1654*a} color={C.acc}/>
  <Type x={1120} y={996} size={34} w={704} weight={400} style={{textAlign:'right'}}>Explore. Adjust. Make it yours.</Type>
  <Sound src="sfx/colour.wav" at={40} volume={.3}/>
 </Full>;
};
