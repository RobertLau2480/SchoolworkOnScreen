"""将 fonts/ 下的 TTF/OTF 字体转换为 WOFF2，输出到 fonts-woff2/ 目录。
跳过 .ttc（TrueType Collection，WOFF2 不支持）。"""
import os
import sys
from fontTools.ttLib import TTFont

SRC = 'fonts'
DST = 'fonts-woff2'
os.makedirs(DST, exist_ok=True)

total_before = 0
total_after = 0
for name in sorted(os.listdir(SRC)):
    stem, ext = os.path.splitext(name)
    if ext.lower() not in ('.ttf', '.otf'):
        print(f'SKIP {name}')
        continue
    src_path = os.path.join(SRC, name)
    dst_path = os.path.join(DST, stem + '.woff2')
    before = os.path.getsize(src_path)
    try:
        font = TTFont(src_path)
        font.flavor = 'woff2'
        font.save(dst_path)
        after = os.path.getsize(dst_path)
        total_before += before
        total_after += after
        print(f'{name}: {before/1024/1024:.2f}MB -> {after/1024/1024:.2f}MB', flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f'{name}: FAILED - {exc}', file=sys.stderr, flush=True)

print(f'TOTAL: {total_before/1024/1024:.2f}MB -> {total_after/1024/1024:.2f}MB')