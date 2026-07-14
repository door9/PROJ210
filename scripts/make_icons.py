# -*- coding: utf-8 -*-
"""앱 아이콘 PNG 생성 (favicon.svg와 같은 디자인: 녹색 바탕 + 금색 상승선)"""
from PIL import Image, ImageDraw

BG = (15, 76, 58, 255)      # #0f4c3a
GOLD = (232, 217, 160, 255) # #e8d9a0


def draw_icon(size, pad_ratio=0.0):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = size * 22 // 100
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)

    # 상승선: (14,44) → (26,30) → (34,36) → (50,18), 원 (50,18) — 64 기준 좌표
    pad = size * pad_ratio
    scale = (size - 2 * pad) / 64
    pts = [(14, 46), (26, 32), (34, 38), (50, 20)]
    pts = [(pad + x * scale, pad + y * scale) for x, y in pts]
    w = max(2, round(size * 5 / 64))
    d.line(pts, fill=GOLD, width=w, joint='curve')
    # 선 끝 둥글게 + 종점 원
    for p, rad in [(pts[0], w / 2), (pts[-1], size * 5 / 64)]:
        d.ellipse([p[0] - rad, p[1] - rad, p[0] + rad, p[1] + rad], fill=GOLD)
    return img


for size, name, pad in [
    (192, 'icon-192.png', 0.0),
    (512, 'icon-512.png', 0.0),
    (512, 'icon-512-maskable.png', 0.12),  # 마스크 안전영역 여백
    (180, 'apple-touch-icon.png', 0.0),
]:
    draw_icon(size, pad).save(name)
    print('OK', name)
