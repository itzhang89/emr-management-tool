# scripts/stage-artifacts.py
import os, shutil
from pathlib import Path

label       = os.environ["ARTIFACT_LABEL"]
bundle_dir  = Path(os.environ["BUNDLE_DIR"])
stage_dir   = Path("release-artifacts")
stage_dir.mkdir(exist_ok=True)

print(f"Inspecting {bundle_dir}")
if not bundle_dir.exists():
    raise SystemExit(f"Bundle directory missing: {bundle_dir}")
for p in sorted(bundle_dir.rglob("*")):
    print(p)

artifacts = [
    p
    for pattern in os.environ["ARTIFACT_PATTERNS"].split(";")
    for p in bundle_dir.rglob(pattern)
    if p.is_file()
]
if not artifacts:
    raise SystemExit(f"No installable artifacts found in {bundle_dir}")

for artifact in artifacts:
    dest = stage_dir / f"{label}-{artifact.name}"
    shutil.copy2(artifact, dest)
    print(f"Staged → {dest}")