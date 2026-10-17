"""Compare composited frames with a footage-only reference frame.

For each frame: the share of pixels identical (within 6/255) to the reference,
i.e. where the footage shows through untouched, and the share that changed,
i.e. where the overlay landed. A working alpha overlay is mostly "through"
with a band of "changed"; an overlay that lost alpha is mostly "changed".
"""
import json
import sys

from PIL import Image, ImageChops

ref = Image.open(sys.argv[1]).convert("RGB")
out = {}
for path in sys.argv[2:]:
    im = Image.open(path).convert("RGB")
    diff = ImageChops.difference(ref, im).convert("L")
    hist = diff.histogram()
    total = sum(hist)
    through = sum(hist[:7]) / total
    # Mean brightness of the frame, to spot a black-box overlay.
    lum = im.convert("L").histogram()
    mean = sum(i * n for i, n in enumerate(lum)) / total
    out[path.rsplit("/", 1)[-1]] = {"footageThroughPct": round(100 * through, 1), "changedPct": round(100 * (1 - through), 1), "meanLuma": round(mean, 1)}
print(json.dumps(out))
