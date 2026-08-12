#!/usr/bin/env python3
"""Convert the transcribed data files to the source's own typography.

City of Winter's PDFs contain zero straight quotes: apostrophes are U+2019 and
quotation marks are U+201C/U+201D. The transcription was typed with ASCII quotes,
so this normalises it once, in place, to keep the corpus byte-verbatim.

  usage: python3 build/smartquote.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))


def smarten(s):
    # paired double quotes -> “ ”
    out, open_d = [], True
    for ch in s:
        if ch == '"':
            out.append("“" if open_d else "”")
            open_d = not open_d
        else:
            out.append(ch)
    s = "".join(out)
    # opening single quote: after start/space/open-double, before a word char
    s = re.sub(r"(^|[\s“(])'(?=[^\s])", lambda m: m.group(1) + "‘", s)
    # everything else that is a straight apostrophe -> ’
    s = s.replace("'", "’")
    return s


def walk(node):
    if isinstance(node, str):
        return smarten(node)
    if isinstance(node, list):
        return [walk(x) for x in node]
    if isinstance(node, dict):
        return {k: (v if k.startswith("_") else walk(v)) for k, v in node.items()}
    return node


for name in ("procedures.json", "source-data.json"):
    path = os.path.join(ROOT, name)
    data = json.load(open(path))
    with open(path, "w") as f:
        json.dump(walk(data), f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("normalised", name)

# .lore bodies live in gen_corpus.py and are smartened there at emit time, so
# they stay normalised across regeneration rather than being patched after it.
