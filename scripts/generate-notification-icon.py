"""Deriva a silhueta vetorial do símbolo oficial; não altera o ícone de abertura."""
from pathlib import Path
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[1]
im=Image.open(root/'icon-192.png').convert('RGB')
rects=[]
for y in range(im.height):
    start=None
    for x in range(im.width+1):
        if x<im.width:
            red,green,blue=im.getpixel((x,y))
            ink=(min(red,green,blue)>190) or (red>200 and 65<green<205 and blue<110)
        else: ink=False
        if ink and start is None:start=x
        if not ink and start is not None:rects.append((start,y,x,y+1));start=None
left=min(x[0] for x in rects);top=min(x[1] for x in rects)
right=max(x[2] for x in rects);bottom=max(x[3] for x in rects)
scale=20/max(right-left,bottom-top)
dx=(24-(right-left)*scale)/2;dy=(24-(bottom-top)*scale)/2
rects=[((x-left)*scale+dx,(y-top)*scale+dy,(z-left)*scale+dx,(w-top)*scale+dy) for x,y,z,w in rects]
path=''.join(f'M{x:.4f},{y:.4f}H{z:.4f}V{w:.4f}H{x:.4f}Z' for x,y,z,w in rects)
out=root/'assets/notifications';out.mkdir(parents=True,exist_ok=True)
(out/'quemfaz-monochrome.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="{path}"/></svg>\n')
kit=root/'android-notification-fix/app/src/main/res';kit.mkdir(parents=True,exist_ok=True)
for density,size in [('mdpi',24),('hdpi',36),('xhdpi',48),('xxhdpi',72),('xxxhdpi',96)]:
    factor=size/24*8
    alpha=Image.new('L',(size*8,size*8),0);draw=ImageDraw.Draw(alpha)
    for x,y,z,w in rects:draw.rectangle((round(x*factor),round(y*factor),round(z*factor)-1,round(w*factor)-1),fill=255)
    alpha=alpha.resize((size,size),Image.Resampling.LANCZOS)
    png=Image.new('RGBA',(size,size),(255,255,255,0));png.putalpha(alpha)
    target=kit/f'drawable-{density}';target.mkdir(exist_ok=True)
    png.save(target/'ic_stat_quemfaz.png')
    if size==96:png.save(out/'quemfaz-badge-96.png')
target=kit/'drawable';target.mkdir(exist_ok=True)
(target/'ic_stat_quemfaz.xml').write_text(f'<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FFFFFFFF" android:pathData="{path}"/></vector>\n')
print('Símbolo oficial em branco/transparente: SVG, VectorDrawable 24dp e PNG 24/36/48/72/96px.')
