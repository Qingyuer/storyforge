"""Exercise the actual bundled runtime and built assets without author browser data."""
import json, subprocess, sys, time, urllib.request
from pathlib import Path
root = Path(sys.argv[1]).resolve()
node = root / 'runtime' / ('node.exe' if sys.platform == 'win32' else 'node')
proc = subprocess.Popen([str(node), str(root / 'scripts/distribution/server.mjs'), '--no-open'], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
try:
    for attempt in range(80):
        if proc.poll() is not None:
            raise RuntimeError(proc.stdout.read().decode())
        try:
            html = urllib.request.urlopen('http://localhost:1111/storyforge/', timeout=2).read().decode()
            break
        except Exception:
            time.sleep(.25)
    else:
        raise RuntimeError('Bundled server did not start.')
    assert '/storyforge/assets/' in html and 'showcase-entry' not in html
    manifest = json.loads((root / 'release.json').read_text())
    print(json.dumps({'launch': 'passed', 'release': manifest}))
finally:
    proc.terminate()
    try: proc.wait(timeout=8)
    except subprocess.TimeoutExpired: proc.kill()
