"""Keep 12ui's exported document and bindings; externalize embedded image assets."""
import argparse
import base64
from pathlib import Path
from bs4 import BeautifulSoup
p=argparse.ArgumentParser(); p.add_argument('name'); p.add_argument('source'); args=p.parse_args()
soup=BeautifulSoup(Path(args.source).read_text(),'html.parser')
assets=Path('frontend/public/design'); assets.mkdir(parents=True,exist_ok=True)
for i,img in enumerate(soup.select('img')):
    src=img.get('src','')
    if src.startswith('data:'):
        header,data=src.split(',',1); extension=header.split('/')[1].split(';')[0].replace('svg+xml','svg')
        name=f'{args.name}-{i}.{extension}'; (assets/name).write_bytes(base64.b64decode(data)); img['src']=f'/design/{name}'
for script in soup.select('script'): script.decompose()
css='\n'.join(s.get_text() for s in soup.select('style'))
Path(f'frontend/src/design/{args.name}.css').write_text(css)
Path(f'frontend/src/design/{args.name}.html').write_text(soup.body.decode_contents())
print(f'Prepared {args.name}: retained exported structure and element ids.')
