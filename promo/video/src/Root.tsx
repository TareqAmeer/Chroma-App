import React from 'react';
import {Composition,Folder} from 'remotion';
import {Promo,TOTAL} from './Promo';import {Square} from './Square';
import {Hero} from './scenes/Hero';import {Gallery} from './scenes/Gallery';import {Studio} from './scenes/Studio';import {Looks} from './scenes/Looks';import {Texture} from './scenes/Texture';import {Frames} from './scenes/Frames';import {Workflow} from './scenes/Workflow';import {Download} from './scenes/Download';
import {Ep1,EP1_FRAMES} from './ep1/Ep1';
const Ep1V:React.FC=()=> <Ep1 vertical/>;
const attach=(Scene:React.FC,start:number):React.FC=>()=> <><Scene/><Square offset={start}/></>;
const scenes=[{id:'FilmFeeling',component:attach(Hero,0),duration:180},{id:'Gallery',component:attach(Gallery,180),duration:180},{id:'Studio',component:attach(Studio,360),duration:150},{id:'Colour',component:attach(Looks,510),duration:270},{id:'Grain',component:attach(Texture,780),duration:300},{id:'Frames',component:attach(Frames,1080),duration:240},{id:'Export',component:attach(Workflow,1320),duration:210},{id:'Download',component:attach(Download,1530),duration:270}];
export const Root:React.FC=()=> <><Composition id="Promo" component={Promo} durationInFrames={TOTAL} fps={30} width={1920} height={1080}/><Folder name="SquareOne"><Composition id="Ep1" component={Ep1} durationInFrames={EP1_FRAMES} fps={30} width={1920} height={1080}/><Composition id="Ep1Vertical" component={Ep1V} durationInFrames={EP1_FRAMES} fps={30} width={1080} height={1920}/></Folder><Folder name="Scenes">{scenes.map(s=><Composition key={s.id} id={s.id} component={s.component} durationInFrames={s.duration} fps={30} width={1920} height={1080}/>)}</Folder></>;
