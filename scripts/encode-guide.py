"""Encode documentation screenshots; requires Python 3 and Pillow."""
import json
import sys
from pathlib import Path
from PIL import Image

manifest, destination = sys.argv[1:]
frames = json.loads(Path(manifest).read_text())
images = []
for frame in frames:
    with Image.open(frame['file']) as source:
        images.append(source.convert('RGB').quantize(colors=192))
images[0].save(
    f'{destination}.gif', save_all=True, append_images=images[1:],
    duration=[frame['duration'] for frame in frames], loop=0, optimize=True,
    disposal=2,
)
with Image.open(frames[-1]['file']) as poster:
    poster.save(f'{destination}.png')
print(f'{destination}.gif: {Path(f"{destination}.gif").stat().st_size:,} bytes')
