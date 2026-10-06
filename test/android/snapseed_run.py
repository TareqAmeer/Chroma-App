"""Time the observed Snapseed Export action through completed MediaStore publication."""
import json,os,pathlib,re,subprocess,time,xml.etree.ElementTree as ET,sys
out=pathlib.Path(__file__).parent/'out'
adb=pathlib.Path(os.environ.get('ANDROID_HOME',pathlib.Path.home()/'android-tools/sdk'))/'platform-tools/adb.exe'
def cmd(*args):return subprocess.check_output([str(adb),*args]).decode('utf-8',errors='replace')
def nodes():
    status=cmd('shell','uiautomator','dump','--compressed','/sdcard/snapseed-measure.xml')
    if 'dumped' not in status:raise RuntimeError(status)
    return [n.attrib for n in ET.fromstring(cmd('shell','cat','/sdcard/snapseed-measure.xml')).iter('node')]
def tap(n):
    x1,y1,x2,y2=map(int,re.findall(r'\d+',n['bounds']));cmd('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
def media():
    data=cmd('shell','content','query','--uri','content://media/external/images/media','--projection','_id:_data:is_pending:_size')
    rows=[]
    for l in data.splitlines():
        m=re.search(r'_id=(\d+), _data=(.*?), is_pending=(\d+), _size=(\d+)',l)
        if m:rows.append({'id':int(m[1]),'path':m[2],'pending':int(m[3]),'bytes':int(m[4])})
    return rows
label=sys.argv[1] if len(sys.argv)>1 else 'unchanged'
count=int(sys.argv[2]) if len(sys.argv)>2 else 4
results=[]
for run in range(count):
    tree=nodes()
    if not any(n.get('text')=='Create a copy with permanent changes.' for n in tree):
        choices=[n for n in tree if n.get('text')=='Export']
        if len(choices)!=1:raise RuntimeError('Expected editor Export button')
        tap(choices[0]);tree=nodes()
    if not any('ORIGINAL SIZE, JPG 100%' in n.get('text','') for n in tree):raise RuntimeError('Original size/JPG100 not selected')
    choices=[n for n in tree if n.get('text')=='Export' and int(re.findall(r'\d+',n['bounds'])[1])>1000]
    if len(choices)!=1:raise RuntimeError('Expected flattening Export action')
    before={r['id'] for r in media()}
    started=time.perf_counter();tap(choices[0]);saved=None
    for i in range(240):
        current=media()
        candidates=[r for r in current if r['id'] not in before and not r['pending'] and r['bytes']>0]
        if candidates:saved=max(candidates,key=lambda r:r['id']);break
        time.sleep(.1)
    elapsed=(time.perf_counter()-started)*1000
    if not saved:raise RuntimeError('No completed new MediaStore JPEG after export')
    saved.update({'run':run,'warmup':run==0,'method':'snapseed-'+label,'totalMs':elapsed,'quality':100,'resize':'Do not resize'})
    local=out/f'snapseed-{label}-{run}.jpeg'
    subprocess.run([str(adb),'pull',saved['path'],str(local)],check=True,capture_output=True)
    from PIL import Image
    with Image.open(local) as im:im.load();saved['dimensions']=list(im.size)
    saved['savedFile']=local.name;results.append(saved);print(json.dumps(saved),flush=True)
    (out/f'snapseed-{label}.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    time.sleep(2)
