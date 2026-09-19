"""Extract the supplied PDF's rows and exact timeline swatches reproducibly."""
import argparse
import json
import re
import subprocess
from pathlib import Path
import pymupdf

p = argparse.ArgumentParser()
p.add_argument('pdf')
p.add_argument('--output', default='backend/study/reading_plan.json')
args = p.parse_args()
text = subprocess.check_output(['pdftotext', '-layout', args.pdf, '-'], text=True)
rows = []
for line in text.splitlines():
    match = re.match(r'Day (\d+)\s{2,}(.*)', line)
    if match:
        rows.append({'number': int(match[1]), 'readings': [re.sub(r':\s+', ':', x.strip()) for x in re.split(r'\s{2,}', match[2])]})
assert [r['number'] for r in rows] == list(range(1, 366))
assert all(2 <= len(r['readings']) <= 3 for r in rows)
colors = {}
for page in pymupdf.open(args.pdf):
    for drawing in page.get_drawings():
        rect = drawing['rect']
        if drawing['fill'] and rect.width > 65 and rect.height > 20:
            name = page.get_textbox(rect).strip().replace('\n', ' ')
            if name and len(name) < 30 and name not in ['Period', 'First Reading', 'Second Reading', 'Psalm / Proverbs']:
                colors[name] = '#' + ''.join(f'{round(v*255):02x}' for v in drawing['fill'])
starts = [(1,'Early World'),(6,'Patriarchs'),(27,'Egypt and Exodus'),(52,'Desert Wanderings'),(81,'Conquest and Judges'),(99,'Messianic Checkpoint'),(106,'Royal Kingdom'),(154,'Messianic Checkpoint'),(162,'Divided Kingdom'),(184,'Exile'),(258,'Messianic Checkpoint'),(267,'Return'),(282,'Maccabean Revolt'),(313,'Messianic Fulfillment'),(322,'The Church')]
for row in rows:
    row['era'] = next(name for start,name in reversed(starts) if row['number'] >= start)
    row['color'] = colors[row['era']]
Path(args.output).write_text(json.dumps(rows, indent=2)+'\n')
print(f'Extracted {len(rows)} days; colors: {colors}')
