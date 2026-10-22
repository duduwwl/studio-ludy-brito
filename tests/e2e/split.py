import sys
from PIL import Image
f=sys.argv[1]; im=Image.open(f); w,h=im.size; step=int(sys.argv[2]) if len(sys.argv)>2 else 1800
scale=0.5 if w>800 else 1
for i in range(0,h,step):
    c=im.crop((0,i,w,min(h,i+step)))
    c.resize((int(w*scale),int(c.size[1]*scale))).save(f.replace('.png',f'-p{i//step}.png'))
print(h, (h+step-1)//step)
