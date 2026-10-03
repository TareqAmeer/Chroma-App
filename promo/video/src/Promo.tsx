import React from 'react';
import {AbsoluteFill,Sequence,staticFile,interpolate,useCurrentFrame} from 'remotion';
import {Audio} from '@remotion/media';
import {Hero} from './scenes/Hero';
import {Studio} from './scenes/Studio';
import {Looks} from './scenes/Looks';
import {Texture} from './scenes/Texture';
import {Frames} from './scenes/Frames';
import {Workflow} from './scenes/Workflow';
import {Download} from './scenes/Download';
import {Gallery} from './scenes/Gallery';
import {Square} from './Square';
export const TOTAL=1800;
export const Promo:React.FC=()=>{
 const f=useCurrentFrame();
 const level=interpolate(f,[0,16,1670,1800],[0,.78,.78,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 return <AbsoluteFill>
  <Sequence name="Film feeling" from={0} durationInFrames={180} premountFor={30}><Hero/></Sequence>
  <Sequence name="Find the one" from={180} durationInFrames={180} premountFor={30}><Gallery/></Sequence>
  <Sequence name="The square is a slider" from={360} durationInFrames={150} premountFor={30}><Studio/></Sequence>
  <Sequence name="Colour to photograph" from={510} durationInFrames={270} premountFor={30}><Looks/></Sequence>
  <Sequence name="Grain to photograph" from={780} durationInFrames={300} premountFor={30}><Texture/></Sequence>
  <Sequence name="Draw the frame" from={1080} durationInFrames={240} premountFor={30}><Frames/></Sequence>
  <Sequence name="One export" from={1320} durationInFrames={210} premountFor={30}><Workflow/></Sequence>
  <Sequence name="The square becomes the logo" from={1530} durationInFrames={270} premountFor={30}><Download/></Sequence>
  <Square/>
  <Audio src={staticFile('music/square-study.wav')} volume={level} premountFor={30}/>
 </AbsoluteFill>;
};
