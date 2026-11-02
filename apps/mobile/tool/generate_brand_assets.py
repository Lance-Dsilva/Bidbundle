#!/usr/bin/env python3
"""Offline, pinned renderer. No downloaded assets or font dependencies."""
import hashlib,json,pathlib,re,subprocess,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[3]
MOBILE=ROOT/'apps/mobile'
SOURCE=ROOT/'public/bundleen/brand/bundleen-company-icon.svg'
RSVG='/opt/homebrew/bin/rsvg-convert'
MAGICK='/opt/homebrew/bin/magick'
rsvg_version=subprocess.check_output([RSVG,'--version'],text=True).splitlines()[0]
magick_version=subprocess.check_output([MAGICK,'-version'],text=True).splitlines()[0]
if rsvg_version != 'rsvg-convert version 2.61.3' or not magick_version.startswith('Version: ImageMagick 7.1.2-13 '):
    raise SystemExit('Pinned rsvg-convert 2.61.3 and ImageMagick 7.1.2-13 required')
source=SOURCE.read_text()
inner=re.sub(r'^.*?<svg[^>]*>|</svg>\s*$', '', source, flags=re.S)
outputs=[]
def render(relative,size,margin=0,opaque=False):
    target=MOBILE/relative;target.parent.mkdir(parents=True,exist_ok=True)
    extent=96+2*margin
    wrapped=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-margin} {-margin} {extent} {extent}">{inner}</svg>'
    with tempfile.TemporaryDirectory() as tmp:
        svg=pathlib.Path(tmp)/'source.svg';svg.write_text(wrapped)
        png=pathlib.Path(tmp)/'render.png'
        args=[RSVG,'--width',str(size),'--height',str(size),'--output',str(png)]
        if opaque: args+=['--background-color','#F8F6EF']
        subprocess.run(args+[str(svg)],check=True)
        subprocess.run([MAGICK,str(png),'-strip',*(['-alpha','off'] if opaque else []),'-define','png:exclude-chunk=time',str(target)],check=True)
    outputs.append({'path':relative,'width':size,'height':size,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
render('assets/brand/company-mark.png',288)
contents=json.loads((MOBILE/'ios/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json').read_text())
seen=set()
for item in contents['images']:
    name=item['filename']
    if name in seen: continue
    seen.add(name)
    size=int(float(item['size'].split('x')[0])*int(item['scale'][0]))
    render('ios/Runner/Assets.xcassets/AppIcon.appiconset/'+name,size,16,True)
for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    render(f'android/app/src/main/res/mipmap-{density}/ic_launcher.png',size,16,True)
# Adaptive foreground keeps the exact mark within the central safe area.
render('android/app/src/main/res/drawable-nodpi/company_foreground.png',432,48)
manifest={'source':str(SOURCE.relative_to(ROOT)),'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'provenance':['docs/homepage-v5.md','src/components/brand/BundleenCompanyIcon.tsx'],'tools':{'rsvg':rsvg_version,'imagemagick':magick_version},'derivation':'Unchanged SVG child geometry/colors. Uniform rasterization; launcher padding and opaque warm-paper background. Adaptive foreground padded separately. No font or generated logo.','outputs':sorted(outputs,key=lambda x:x['path'])}
(MOBILE/'assets/brand/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
