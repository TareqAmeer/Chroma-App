import React from 'react';
import {useCurrentFrame} from 'remotion';
import {C,p,mix} from '../theme';
import {Full,Box,Photo,Type,Sound} from '../shared';
export const Gallery:React.FC=()=>{
 const f=useCurrentFrame(),filter=p(f,74,34),pick=p(f,98,38);
 const keep=[2,12,21];
 return <Full>
  <Type x={96} y={70} size={112}>Find the one.</Type>
  <Type x={96} y={205} size={46} weight={400}>Filter your photo library.</Type>
  {Array.from({length:24},(_,i)=>{
   const k=keep.indexOf(i),keepIt=k>=0;
   const x0=96+(i%8)*216,y0=340+Math.floor(i/8)*194;
   const x1=keepIt?[96,750,1420][k]:x0+(i%2?1:-1)*1920;
   const selected=i===12,a=selected?pick:0;
   return <Box key={i} x={mix(x0,x1,filter)} y={mix(y0,490,filter)-55*a} w={mix(204,300,filter)+160*a} h={mix(170,280,filter)+140*a}>
    {selected?<div style={{position:'absolute',left:-320*(300+160*a)/1076,top:-210*(280+140*a)/724,width:2000*(300+160*a)/1076,height:1111*(280+140*a)/724}}><Photo src="studio-4.webp"/></div>:<Photo src={`gallery-${String(i+1).padStart(2,'0')}.jpg`}/>}
   </Box>;
  })}
  {f>68&&f<115&&<Type x={820} y={241} size={42} color={C.paper} style={{zIndex:30}}>Favourites</Type>}
  {f>129&&<Type x={96} y={914} size={66} weight={400}>Found it. Let’s make it yours.</Type>}
  <Box x={96} y={284} w={1728} h={52}><div style={{position:'absolute',left:0,top:0,width:1728,height:1080}}><Photo src="library.webp"/></div></Box>
  <Sound src="sfx/tactile.wav" at={74} volume={.26}/><Sound src="sfx/pick.wav" at={134} volume={.22}/>
 </Full>;
};
