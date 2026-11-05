"""Build a portable Windows ZIP or verify its extracted file inventory."""

import argparse
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "SHA256SUMS.json"
PLATFORM = "windows-x64"
REQUIRED = {
    "Codex Usage.exe", "resources/app.asar", "README.md",
    "FURU-LICENSE.txt", "LICENSE.electron.txt", "LICENSES.chromium.html",
    "docs/assets/app-screen.png", "docs/assets/availability-screen.png",
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree(root):
    return {path.relative_to(root).as_posix(): path
            for path in root.rglob("*") if path.is_file()}


def inventory(files):
    return [{"path": name, "sha256": sha256(path), "size": path.stat().st_size}
            for name, path in sorted(files.items())]


def require_runtime(files):
    missing = REQUIRED - files.keys()
    if missing:
        raise ValueError(f"Missing distribution files: {', '.join(sorted(missing))}")


def build():
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    output = ROOT / "release-build"
    files = tree(output / "win-unpacked")
    files.update({"README.md": ROOT / "README.md", "FURU-LICENSE.txt": ROOT / "LICENSE"})
    files.update({f"docs/{name}": path for name, path in tree(ROOT / "docs").items()
                  if name in {"assets/app-screen.png", "assets/availability-screen.png",
                              "assets/thumbnail.png"}})
    require_runtime(files)
    manifest = {"version": version, "platform": PLATFORM, "files": inventory(files)}
    archive_path = output / f"CodexUsage-v{version}-{PLATFORM}.zip"
    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED, compresslevel=5) as archive:
        for name, path in sorted(files.items()):
            archive.write(path, name)
        archive.writestr(MANIFEST, json.dumps(manifest, indent=2) + "\n")
    (output / "SHA256SUMS.txt").write_bytes(
        f"{sha256(archive_path)}  {archive_path.name}\n".encode("ascii"))
    print(archive_path)


def verify_tree(root):
    files = tree(root)
    manifest_path = files.pop(MANIFEST)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    require_runtime(files)
    if manifest["platform"] != PLATFORM or manifest["files"] != inventory(files):
        raise ValueError("Manifest and extracted files differ")
    print(f"Verified {len(files)} files for v{manifest['version']} ({PLATFORM})")


def verify(path):
    if path.is_dir():
        verify_tree(path)
        return
    with TemporaryDirectory(prefix="codex-usage-verify-") as directory:
        with ZipFile(path) as archive:
            names = archive.namelist()
            if len({name.casefold() for name in names}) != len(names):
                raise ValueError("ZIP contains duplicate paths")
            archive.extractall(directory)
        verify_tree(Path(directory))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("build")
    subcommands.add_parser("verify").add_argument("path", type=Path)
    args = parser.parse_args()
    if args.command == "build":
        build()
    else:
        verify(args.path)
