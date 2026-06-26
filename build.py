#!/usr/bin/env python3
"""
build.py — собирает app.jsx в app.js, чтобы Babel не грузился и не работал в браузере.

Зачем: раньше index.html тянул @babel/standalone (около 3 МБ) и компилировал app.jsx
прямо на странице при каждом заходе. Это и был главный тормоз начальной загрузки.
Теперь компиляция один раз здесь, а пользователь получает готовый app.js.

Запуск из папки проекта:
    python3 build.py

Что делает:
  1. читает app.jsx;
  2. транспилирует JSX в обычный JS через Babel в headless-браузере (Playwright);
  3. пишет app.js рядом;
  4. проставляет в index.html ?v=<хеш>, чтобы у людей не висела старая версия из кеша.

ВАЖНО: правь app.jsx, а не app.js. После любой правки app.jsx запусти build.py заново.
"""
import sys, re, hashlib, pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
jsx_path = root / "app.jsx"
js_path = root / "app.js"
html_path = root / "index.html"

if not jsx_path.exists():
    print("НЕ НАЙДЕН app.jsx в", root, file=sys.stderr); sys.exit(1)

src = jsx_path.read_text(encoding="utf-8")

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page()
    page.goto("about:blank")
    # грузим Babel standalone из CDN (нужен только на момент сборки); add_script_tag ждёт загрузки
    page.add_script_tag(url="https://unpkg.com/@babel/standalone@7/babel.min.js")
    out = page.evaluate(
        "(code) => window.Babel.transform(code, { presets: ['react'], compact: false, comments: false }).code",
        src,
    )
    browser.close()

if not out or "React.createElement" not in out:
    print("СБОРКА НЕ УДАЛАСЬ: на выходе нет React.createElement, app.js не перезаписан.", file=sys.stderr)
    sys.exit(2)

header = "/* СГЕНЕРИРОВАНО из app.jsx через build.py. Не редактируй вручную, правь app.jsx и пересобери. */\n"
js_path.write_text(header + out, encoding="utf-8")

ver = hashlib.md5(out.encode("utf-8")).hexdigest()[:8]
# версия для styles.css по его содержимому, чтобы правки дизайна не висели в кеше у людей
css_path = root / "styles.css"
css_ver = hashlib.md5(css_path.read_bytes()).hexdigest()[:8] if css_path.exists() else None
if html_path.exists():
    html = html_path.read_text(encoding="utf-8")
    new_html = re.sub(r'src="app\.js(?:\?v=[^"]*)?"', f'src="app.js?v={ver}"', html)
    if css_ver:
        new_html = re.sub(r'href="styles\.css(?:\?v=[^"]*)?"', f'href="styles.css?v={css_ver}"', new_html)
    if new_html != html:
        html_path.write_text(new_html, encoding="utf-8")

print(f"app.js собран: {len(out)} символов, версия v={ver}" + (f", styles.css v={css_ver}" if css_ver else ""))
