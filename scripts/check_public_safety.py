from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCAN_DIRS = [
    ROOT / "src",
    ROOT / "public",
    ROOT / "dist",
    ROOT / "docs",
    ROOT / "agent_new.md",
    ROOT / "scripts",
    ROOT / "README.md",
    ROOT / "package.json",
    ROOT / "package-lock.json",
    ROOT / "vercel.json",
]
BLOCKED_EXTENSIONS = {".xlsx", ".xls", ".csv", ".geojson", ".pkl", ".joblib"}
BLOCKED_PATTERNS = [
    re.compile(r"B\d{9}"),
    re.compile(r"인천[가-힣A-Za-z0-9]+초등학교"),
    re.compile(r"37\.\d{4,}"),
    re.compile(r"126\.\d{4,}"),
]
ALLOWED_TEXT_PATHS = {
    ROOT / "scripts" / "build_anon_public_data.py",
    ROOT / "scripts" / "check_public_safety.py",
}


def iter_files() -> list[Path]:
    files: list[Path] = []
    for target in SCAN_DIRS:
        if not target.exists():
            continue
        if target.is_file():
            files.append(target)
            continue
        for path in target.rglob("*"):
            if path.is_file():
                files.append(path)
    return files


def main() -> int:
    failures: list[str] = []
    for path in iter_files():
        rel = path.relative_to(ROOT)
        if path.suffix.lower() in BLOCKED_EXTENSIONS:
            failures.append(f"Blocked file extension: {rel}")
            continue
        if path.suffix.lower() not in {".json", ".ts", ".tsx", ".css", ".html", ".md", ".py"} and path.name not in {"package.json", "vercel.json"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in BLOCKED_PATTERNS:
            if path in ALLOWED_TEXT_PATHS and pattern.pattern in {r"37\.\d{4,}", r"126\.\d{4,}"}:
                continue
            if pattern.search(text):
                failures.append(f"Potential identifier pattern {pattern.pattern!r}: {rel}")

    if failures:
        print("Safety check failed:")
        for item in failures:
            print(f"- {item}")
        return 1

    print("Safety check passed: no blocked files or identifier patterns found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
