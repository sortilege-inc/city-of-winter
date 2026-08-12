#!/usr/bin/env python3
"""Syntax-check every module in the app, inline page scripts included.

The pages carry their logic in inline `<script type="module">` blocks, which a
browser fails silently on: a stray paren leaves a blank page and an empty
console. This parses each one with node so that never reaches a player.

  usage: python3 check_js.py
"""
import glob, os, re, subprocess, sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
STRIP = re.compile(r"(?ms)^import\s+.*?from\s+['\"][^'\"]+['\"];\s*$")
bad = 0

def check(label, code):
    global bad
    open('/tmp/_check.mjs', 'w').write(STRIP.sub('', code))
    r = subprocess.run(['node', '--check', '/tmp/_check.mjs'], capture_output=True, text=True)
    if r.returncode:
        bad += 1
        print(f"  SYNTAX ERROR in {label}")
        print('    ' + r.stderr.split('\n\n')[0].strip().replace('\n', '\n    ')[:400])

for f in sorted(glob.glob('app/*.js') + glob.glob('*/*.js')):
    check(f, open(f).read())
for page in sorted(glob.glob('*.html') + glob.glob('*/*.html')):
    src = open(page).read()
    for i, m in enumerate(re.finditer(r'<script type="module">([\s\S]*?)</script>', src)):
        check(f'{page} inline script #{i + 1}', m.group(1))

print(f"\nJS SYNTAX: {bad} file(s) with errors.")
sys.exit(1 if bad else 0)
