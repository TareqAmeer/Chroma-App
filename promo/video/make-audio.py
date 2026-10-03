#!/usr/bin/env python3
"""Square Study: original 112 BPM major-key groove and dry material cues.
No third-party recordings. Reproducible NumPy synthesis; 48 kHz stereo.
"""
from pathlib import Path
import wave
import numpy as np
ROOT=Path(__file__).resolve().parent/'public'; SR=48000; DUR=60; B=60/112
rng=np.random.default_rng(20261003); song=np.zeros((SR*DUR,2)); clock=np.arange(len(song))/SR

def note(n,dur,kind='keys'):
 t=np.arange(int(dur*SR))/SR; hz=440*2**((n-69)/12)
 if kind=='bass':
  a=np.sin(2*np.pi*hz*t)+.24*np.sin(4*np.pi*hz*t)*np.exp(-t*7)
  return a*(1-np.exp(-t*120))*np.minimum((dur-t)*30,1)*np.exp(-t*2)
 # Warm electric-key timbre: transient partials decay independently.
 a=np.sin(2*np.pi*hz*t)*np.exp(-t*2.3)
 for k,g,d in [(2,.32,4),(3,.12,8),(5,.04,12)]:a+=g*np.sin(2*np.pi*hz*k*t)*np.exp(-t*d)
 return a*(1-np.exp(-t*240))*np.minimum((dur-t)*25,1)

def add(a,at,gain=1,pan=0):
 start=int(at*SR);end=min(len(song),start+len(a))
 if start<0 or start>=len(song):return
 a=a[:end-start]*gain;song[start:end,0]+=a*np.sqrt((1-pan)/2);song[start:end,1]+=a*np.sqrt((1+pan)/2)

# Amaj9, Dmaj9, F#m9, E6/9. Rhythm rather than mournful sustained pads.
chords=[[57,61,64,68,71],[50,57,61,64,66],[54,57,61,64,68],[52,59,61,66,68]]
for bar,at in enumerate(np.arange(0,DUR,4*B)):
 c=chords[(bar//2)%4]
 for off in [0,.75,2,3.5]:
  for j,n in enumerate(c[1:]):
   a=note(n,1.5);level=.043 if off in [0,2] else .031
   add(a,at+off*B,level,(j-1.5)*.25)
   add(a,at+off*B+.75*B,level*.12,-.5)
 for off,n,d in [(0,c[0]-12,.7),(1.5,c[0]-12,.35),(2.5,c[0]-5,.4),(3.25,c[0]-12,.25)]:add(note(n,d,'bass'),at+off*B,.19)
 if bar%2==1:
  for off,n in zip([.5,1.75,2.5,3.5],[c[2]+12,c[4]+12,c[3]+12,c[2]+12]):add(note(n,1.1),at+off*B,.042,.3)

for beat,at in enumerate(np.arange(0,DUR,B)):
 t=np.arange(int(.25*SR))/SR
 kick=np.sin(2*np.pi*(48*t+1.8*(1-np.exp(-t*35))))*np.exp(-t*23)
 add(kick,at,.19 if at>2 else .075)
 if beat%4 in [1,3] and at>3:
  noise=rng.normal(0,1,len(t));body=np.sin(2*np.pi*185*t)*np.exp(-t*32)
  snare=(noise-np.convolve(noise,np.ones(16)/16,'same'))*np.exp(-t*48)+body*.45
  add(snare,at,.034,-.08)
 for off in [0,.5]:
  t=np.arange(int(.085*SR))/SR;n=rng.normal(0,1,len(t));h=np.diff(n,prepend=n[0])*np.exp(-t*100)
  add(h,at+off*B,.01 if off==0 else .015,.4 if beat%2 else -.35)
# Groove breathes around the filter, application and final logo lock.
env=np.minimum(clock/.45,1)*np.minimum((DUR-clock)/2.5,1)
for at in [8.5,11.4,27.8,44.8,53.6]:env*=1-.35*np.exp(-((clock-at)/.15)**2)
song*=env[:,None];song=np.tanh(song*1.35);song*=.72/max(np.max(np.abs(song)),.01)

def write(name,a):
 p=ROOT/name;p.parent.mkdir(parents=True,exist_ok=True)
 if a.ndim==1:a=np.column_stack([a,a])
 with wave.open(str(p),'wb') as f:
  f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((np.clip(a,-.98,.98)*32767).astype('<i2').tobytes())
write('music/square-study.wav',song)
# Felt/card-stock contacts: short noise transients and quiet resonant bodies.
t=np.arange(int(.12*SR))/SR;n=rng.normal(0,1,len(t));wood=np.convolve(n,np.ones(14)/14,'same')*np.exp(-t*100)+.08*np.sin(2*np.pi*310*t)*np.exp(-t*65)
write('sfx/tactile.wav',wood*.6)
t=np.arange(int(.45*SR))/SR;n=rng.normal(0,1,len(t));friction=np.convolve(n,np.ones(48)/48,'same')*np.sin(np.pi*t/.45)**2
write('sfx/rail.wav',friction*.22)
t=np.arange(int(1.2*SR))/SR;n=rng.normal(0,1,len(t));write('sfx/colour.wav',np.convolve(n,np.ones(30)/30,'same')*np.sin(np.pi*t/1.2)**2*.1)
a=np.zeros(int(2.7*SR))
for at in np.linspace(.05,2.4,38):
 t=np.arange(int(.028*SR))/SR;n=rng.normal(0,1,len(t));v=np.convolve(n,np.ones(5)/5,'same')*np.exp(-t*170)*.06;st=int(at*SR);a[st:st+len(v)]+=v
write('sfx/granules.wav',a)
t=np.arange(int(.18*SR))/SR;write('sfx/pick.wav',np.convolve(rng.normal(0,1,len(t)),np.ones(9)/9,'same')*np.exp(-t*60)*.25)
t=np.arange(int(.5*SR))/SR;write('sfx/export.wav',(np.sin(2*np.pi*440*t)*np.exp(-t*25)+.5*np.sin(2*np.pi*660*t)*np.exp(-t*18))*.1)
print('Generated Square Study: 60 seconds, 112 BPM, six dry cues.')
