import json
import os
import urllib.request


PACKAGES = {
    "fonttools": "4.63.0",
    "pyinstaller": "6.22.2",
    "altgraph": "0.17.5",
    "packaging": "26.3",
    "pefile": "2024.8.26",
    "pyinstaller-hooks-contrib": "2026.7",
    "pywin32-ctypes": "0.2.3",
    "setuptools": "84.0.0",
}


def choose_wheel(files):
    preferred = ("py3-none-win_amd64.whl", "py3-none-any.whl", "py2.py3-none-any.whl")
    for suffix in preferred:
        for item in files:
            if item["filename"].endswith(suffix):
                return item
    raise RuntimeError("没有找到适用于 Windows x64 / Python 3 的 Wheel")


os.makedirs(".build/wheels", exist_ok=True)
for package, version in PACKAGES.items():
    with urllib.request.urlopen(f"https://pypi.org/pypi/{package}/{version}/json") as response:
        metadata = json.load(response)
    wheel = choose_wheel(metadata["urls"])
    destination = os.path.join(".build", "wheels", wheel["filename"])
    print(f"下载 {wheel['filename']}")
    urllib.request.urlretrieve(wheel["url"], destination)
