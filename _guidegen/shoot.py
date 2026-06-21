#!/usr/bin/env python3
"""Снимает фрагменты экранов платформы для раздела «Инструкция».
Рендерит _guidegen/frags.html с настоящим styles.css и сохраняет PNG в guide-img/."""
import pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent
out = root.parent / "guide-img"
out.mkdir(exist_ok=True)
url = (root / "frags.html").as_uri()

SHOTS = {
    "shot-today": "step-open-day.png",
    "shot-audio": "step-audio.png",
    "shot-task":  "step-task.png",
    "shot-diary": "step-diary.png",
    "shot-map":   "step-map.png",
    "shot-menu":  "step-menu.png",
}

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 412, "height": 900}, device_scale_factor=2)
    page.goto(url)
    page.wait_for_timeout(700)  # дать шрифтам загрузиться
    for sid, fname in SHOTS.items():
        el = page.query_selector("#" + sid)
        el.screenshot(path=str(out / fname))
        print("сохранил", fname)
    browser.close()
print("готово")
