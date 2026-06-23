"""Ensure login helper HTML in dist is UTF-8 (copy from public after vite build)."""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
FILES = ["login-helper.html", "login-done.html", "firebase-applet-config.json"]

if not DIST.is_dir():
    raise SystemExit(0)

for name in FILES:
    src = ROOT / "public" / name
    if name == "firebase-applet-config.json":
        root_cfg = ROOT / "firebase-applet-config.json"
        if root_cfg.is_file():
            src = root_cfg
    dst = DIST / name
    if src.is_file():
        shutil.copy2(src, dst)
        print(f"[fix-dist-utf8] copied {name}")