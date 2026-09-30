"""
Runs every Playwright test file (tests/test_*.py) one after the other.

Each file starts its own local server and a headless Chromium session. Files are run
from a temporary working directory so the images and videos they generate as fixtures
never end up in the repository.

    python tests/run_all.py            # all files
    python tests/run_all.py panier     # only files whose name contains "panier"
"""
import glob
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    pattern = sys.argv[1] if len(sys.argv) > 1 else ""
    files = sorted(f for f in glob.glob(os.path.join(HERE, "test_*.py")) if pattern in os.path.basename(f))
    total_ok = total_fail = 0
    broken = []
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    for path in files:
        name = os.path.basename(path)
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run([sys.executable, path], cwd=tmp, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
        output = result.stdout + result.stderr
        ok = len(re.findall(r"^\s+OK\s", output, re.M))
        fail = len(re.findall(r"^\s+FAIL\s", output, re.M))
        total_ok += ok
        total_fail += fail
        status = "ok" if result.returncode == 0 and fail == 0 else "FAILED"
        print(f"{status:>6}  {name:<34} {ok} passed" + (f", {fail} failed" if fail else ""))
        if status != "ok":
            broken.append(name)
            lines = [l for l in output.splitlines() if "FAIL" in l or "Error" in l or "Traceback" in l]
            for line in lines[:10]:
                print("        " + line.strip())
    print(f"\n{total_ok} passed, {total_fail} failed across {len(files)} files")
    if broken:
        print("Failing files: " + ", ".join(broken))
        sys.exit(1)


if __name__ == "__main__":
    main()
