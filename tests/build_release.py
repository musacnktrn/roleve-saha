"""Paketle ve çevrimdışı önbellek listesini aynı kaynaklardan üret."""
import argparse
import hashlib
import json
from pathlib import Path
from shutil import copyfile

ROOT = Path(__file__).resolve().parents[1]
def build(target):
    files = [ROOT / name for name in ('index.html', 'app.js', 'manifest.webmanifest')]
    for directory in ('geometry','storage','views','ui','photo','openings','assets'):
        files.extend(f for f in sorted((ROOT / directory).rglob('*'))
                     if f.is_file() and 'tests' not in f.relative_to(ROOT).parts
                     and not any(part.startswith('.') for part in f.relative_to(ROOT).parts)
                     and (f.suffix in {'.js','.mjs','.css','.svg','.woff2','.png','.txt'} or f.name=='LICENSE'))
    digest = hashlib.sha256()
    for f in files:
        relative=f.relative_to(ROOT)
        digest.update(str(relative).encode()); digest.update(f.read_bytes())
        output=target/relative
        output.parent.mkdir(parents=True,exist_ok=True)
        copyfile(f,output)
    names=['./'+str(f.relative_to(ROOT)) for f in files if f.suffix!='.txt' and f.name!='LICENSE']
    template=(ROOT/'tests/worker-template.txt').read_text()
    digest.update(template.encode())
    worker=template.replace('"@REV@"',json.dumps(digest.hexdigest()[:16])).replace('"@FILES@"',json.dumps(names))
    (target/'sw.js').write_text(worker)
    (target/'.nojekyll').touch()
    return len(names),digest.hexdigest()
if __name__=='__main__':
    args=argparse.ArgumentParser();args.add_argument('target',type=Path);target=args.parse_args().target.resolve()
    if target==ROOT or target.is_relative_to(ROOT) and target.name!='dist':
        raise SystemExit('Kaynak dosyalardan ayrı bir yayın dizini kullanın.')
    target.mkdir(parents=True,exist_ok=True)
    print(build(target))

