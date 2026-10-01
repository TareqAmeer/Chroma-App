#!/bin/sh
# All SFX are synthesised here (no third-party audio) -> public/sfx/*.wav
set -e; cd public/sfx; F="ffmpeg -loglevel error -y -f lavfi"
$F -i "aevalsrc='0.6*sin(2*PI*2400*t)*exp(-t*90)':d=0.06" tick.wav
$F -i "aevalsrc='0.8*(random(0)*2-1)*exp(-t*160)':d=0.05" click.wav
$F -i "aevalsrc='0.9*sin(2*PI*(70-40*t)*t)*exp(-t*9)':d=0.5" thud.wav
$F -i "aevalsrc='0.5*(random(0)*2-1)*sin(PI*t/0.28)':d=0.28" -af "highpass=f=900,lowpass=f=6000" whoosh.wav
$F -i "aevalsrc='0.7*(random(0)*2-1)*exp(-t*40)':d=0.12" -af "bandpass=f=2500:width_type=h:w=2000" flip.wav
$F -i "aevalsrc='0.5*sin(2*PI*1568*t)*exp(-t*5)+0.25*sin(2*PI*3136*t)*exp(-t*8)':d=1.0" ping.wav
$F -i "aevalsrc='0.4*sin(2*PI*784*t)*exp(-t*3)+0.2*sin(2*PI*1176*t)*exp(-t*4)':d=1.4" tone.wav
$F -i "aevalsrc='0.9*(random(0)*2-1)*(exp(-t*120)+exp(-(t-0.07)*120)*gte(t,0.07))':d=0.15" -af "bandpass=f=3000:width_type=h:w=3000" shutter.wav
$F -i "aevalsrc='0.5*sin(2*PI*1800*t)*exp(-mod(t,0.04)*140)':d=0.6" ratchet.wav
$F -i "anoisesrc=c=pink:a=0.08:d=2.2" -af "afade=t=in:d=0.3,afade=t=out:st=1.8:d=0.4,highpass=f=2000" hiss.wav
$F -i "aevalsrc='0.35*sin(2*PI*(220+180*t)*t)*sin(PI*t/1.6)':d=1.6" swell.wav
$F -i "aevalsrc='0.7*sin(2*PI*520*t)*exp(-t*35)+0.4*(random(0)*2-1)*exp(-t*200)':d=0.12" clack.wav
# v3 additions: a soft low pulse (90bpm click track), a pen strike, a print pin
$F -i "aevalsrc='0.9*sin(2*PI*55*t)*exp(-t*28)':d=0.18" pulse.wav
$F -i "aevalsrc='0.6*(random(0)*2-1)*sin(PI*t/0.22)':d=0.22" -af "bandpass=f=4200:width_type=h:w=2500" strike.wav
$F -i "aevalsrc='0.8*sin(2*PI*1200*t)*exp(-t*70)+0.5*(random(0)*2-1)*exp(-t*300)':d=0.1" pin.wav
$F -i "aevalsrc='0.9*(random(0)*2-1)*exp(-t*220)+0.7*sin(2*PI*180*t)*exp(-t*60)+0.8*(random(0)*2-1)*exp(-(t-0.09)*180)*gte(t,0.09)':d=0.25" -af "bandpass=f=2200:width_type=h:w=3500" camera.wav
