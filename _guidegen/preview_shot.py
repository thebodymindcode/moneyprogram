#!/usr/bin/env python3
"""Рендерит настоящий собранный app.js с мок-Supabase, открывает вкладку «Инструкция»
и снимает страницу на ширинах телефона. Для самопроверки, не входит в сайт."""
import pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent
out = root
url = (root / "preview.html").as_uri()

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for w in (375, 390):
        page = browser.new_page(viewport={"width": w, "height": 800}, device_scale_factor=2)
        errs = []
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
        page.goto(url)
        page.wait_for_timeout(1500)
        # перейти на вкладку «Инструкция» (нижнее меню)
        page.click(".bottomnav button:has-text('Инструкция')")
        page.wait_for_timeout(800)
        page.screenshot(path=str(out / f"preview-{w}-top.png"))
        page.screenshot(path=str(out / f"preview-{w}-full.png"), full_page=True)
        # горизонтальная прокрутка?
        sw = page.evaluate("document.documentElement.scrollWidth")
        cw = page.evaluate("document.documentElement.clientWidth")
        print(f"w={w} scrollWidth={sw} clientWidth={cw} overflowX={'ДА' if sw > cw + 1 else 'нет'}")
        if errs:
            print(f"  ошибки консоли: {errs[:5]}")
        page.close()
    browser.close()
print("готово")
