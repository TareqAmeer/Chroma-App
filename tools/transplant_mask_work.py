from pathlib import Path
import re
import subprocess

source = Path(r'C:\Users\Tareq\Documents\github\Chroma-App\chromasmith-22.html').read_text(encoding='utf-8')
target_root = Path(r'C:\Users\Tareq\.codex\worktrees\chr152-motion\Chroma-App')
target_path = target_root / 'chromasmith-22.html'
target = subprocess.check_output(['git', 'show', 'HEAD:chromasmith-22.html'], cwd=target_root).decode('utf-8')

helper_start = source.index('// The authored mask remains in m.px.')
helper_end = source.index('// Box filter via a per-row then per-column RUNNING SUM', helper_start)
helpers = source[helper_start:helper_end]

# Remove the old destructive handler before inserting its replacement.
target, removed = re.subn(r'function mskRefineEdges\(m\)\{[\s\S]*?(?=function _smoothstepJS)', '', target, count=1)
assert removed == 1, 'expected exactly one old guided-filter mskRefineEdges'

target = target.replace('const px=m.px,dst=i<4?buf:buf2,ch=i<4?i:i-4;',
                        'const px=mskRefinedPixels(m),dst=i<4?buf:buf2,ch=i<4?i:i-4;', 1)
marker = '// Box filter via a per-row then per-column RUNNING SUM'
target = target.replace(marker, helpers + marker, 1)
target = target.replace('m.px=Uint8ClampedArray.from(refined);m.mtW=header.width;m.mtH=header.height;\n',
                        'm.px=Uint8ClampedArray.from(refined);m.mtW=header.width;m.mtH=header.height;\n'
                        '    m.refineFeather=0;m.refineEdge=0;delete m._refineCache;\n', 1)
target = target.replace("  const desktop=!!window.__TAURI__;\n  const html=hd('Shape')",
                        "  const desktop=!!window.__TAURI__;\n"
                        "  if(fxState.masks.length>=MSK_MAX){toast('Maximum '+MSK_MAX+' masks — delete one first','warn');return;}\n"
                        "  const html='<div class=\"msk-more-hd\">'+fxState.masks.length+' / '+MSK_MAX+' masks</div>'\n"
                        "    +hd('Shape')", 1)
target = target.replace("      +'<div class=\"btn-row\"><button class=\"btn bgh\" onclick=\"mskPaintClear()\">Clear paint</button>'",
                        "         +mskRefineControls(m)\n"
                        "       +'<div class=\"btn-row\"><button class=\"btn bgh\" onclick=\"mskPaintClear()\">Clear paint</button>'", 1)
target = target.replace("       +'<button class=\"btn bgh\" onclick=\"mskRefineEdges(fxState.masks['+mskSel+']);fxUpdate()\" title=\"Snap this mask\\'s soft/rough edges to real edges in the photo (a guided filter, using the photo as its own guide)\">'+icon('refine',14)+' Refine edges</button></div>'",
                        "       +(mskIsAI(m)?'<button class=\"btn bgh\" onclick=\"mskRefineEdges(fxState.masks['+mskSel+']);mskRebuild();fxUpdate()\" title=\"Snap this mask\\'s soft/rough edges to real edges in the photo (a guided filter, using the photo as its own guide)\">'+icon('refine',14)+' Refine edges</button>':'')+'</div>'", 1)
assert 'function mskRefineControls(m)' in target
assert 'const px=mskRefinedPixels(m)' in target
target_path.write_text(target, encoding='utf-8', newline='')

package_path = target_root / 'package.json'
package = subprocess.check_output(['git', 'show', 'HEAD:package.json'], cwd=target_root).decode('utf-8')
package = package.replace('    "mask:test": "node test/mask_raster.mjs",\n',
                          '    "mask:test": "node test/mask_raster.mjs",\n'
                          '    "mask:refinement-math": "node test/mask_refinement_math.mjs",\n', 1)
package_path.write_text(package, encoding='utf-8', newline='')

(target_root / 'test' / 'mask_refinement_math.mjs').write_text(
    (Path(r'C:\Users\Tareq\Documents\github\Chroma-App') / 'test' / 'mask_refinement_math.mjs').read_text(encoding='utf-8'),
    encoding='utf-8', newline='')

devlog = target_root / 'DEVLOG.md'
log = devlog.read_text(encoding='utf-8') if devlog.exists() else ''
if 'CHR-274 / CHR-247 mask refinement slice' not in log:
    log += "\n\n### 2026-10-05 — CHR-274 / CHR-247 mask refinement slice\n"
    log += "- Added non-destructive Feather and signed Edge settings for AI subject/skin/coat rasters, with a cached effective selection in the shared preview/tiled-export mask texture path and exact source reset; new SAM selections clear prior settings.\n"
    log += "- Added the visible eight-mask capacity and blocks opening the Add Mask menu at renderer capacity. Files: `chromasmith-22.html`, `package.json`, `test/mask_refinement_math.mjs`.\n"
    log += "- Verified refinement math, editor HTML validity, and mask raster round-trip. Remaining CHR-274 work: sky/depth, compact layout and labelled quality fixtures. Remaining CHR-247 work: broader mask capabilities/composition and quality gates.\n"
devlog.write_text(log, encoding='utf-8', newline='')
