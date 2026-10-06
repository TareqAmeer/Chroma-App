"""Inspect the authorized emulator UI; use fresh observed labels/bounds for each action."""
import os,pathlib,subprocess,xml.etree.ElementTree as ET
adb=pathlib.Path(os.environ.get('ANDROID_HOME',pathlib.Path.home()/'android-tools/sdk'))/'platform-tools/adb.exe'
out=pathlib.Path(__file__).parent/'out'
subprocess.run([str(adb),'shell','uiautomator','dump','/sdcard/export-ui.xml'],check=True,capture_output=True)
xml=subprocess.check_output([str(adb),'shell','cat','/sdcard/export-ui.xml']).decode()
(out/'snapseed-ui.xml').write_text(xml,encoding='utf-8')
for n in ET.fromstring(xml).iter('node'):
    a=n.attrib
    if a.get('text') or a.get('content-desc'):
        print({k:a.get(k) for k in ['text','content-desc','resource-id','bounds','clickable','selected','checked']})
with (out/'snapseed-screen.png').open('wb') as f:subprocess.run([str(adb),'exec-out','screencap','-p'],stdout=f,check=True)
