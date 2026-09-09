"""
Headless screenshots of local pages, for visually checking a change before it ships.

Playwright directly rather than through Nova Act: Nova Act validates its starting page over
HTTPS and so cannot open a local dev server at all, and nothing here needs an LLM driving the
browser — the point is to look at the pixels and to read the DOM back.

Deliberately headless. It runs against `next dev` on a chosen port, so it can be pointed at a
scratch database and a forged session without touching production.

    python3 scripts/screenshot.py --base http://localhost:3097 \
        --cookie betting_token=<jwt> \
        --shot /betting:dashboard \
        --shot '/betting/<id>:standings:League standings'

Each --shot is PATH:NAME[:TAB], where TAB is the text of a tab to click first. Table headers and
the first rows of every table are printed, so an assertion about ordering can be made from the
rendered DOM rather than from the API alone.
"""
import argparse
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

SETTLE_MS = 9000
"""Long enough for the client-side fetch chain (auth -> markets -> pricing) to finish."""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', default='/tmp/shots')
    ap.add_argument('--cookie', action='append', default=[], help='name=value, repeatable')
    ap.add_argument('--shot', action='append', required=True, help='PATH:NAME[:TAB]')
    ap.add_argument(
        '--pre', action='append', default=[],
        help='Step run on every page before shooting: fill=<value> types into the first '
             'combobox, click=<name> clicks a button by its accessible name. Repeatable, '
             'applied in order — this is what gets past a page that needs a username first.')
    ap.add_argument('--width', type=int, default=1500)
    ap.add_argument('--height', type=int, default=1100)
    ap.add_argument('--settle', type=int, default=SETTLE_MS)
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    host = args.base.split('://', 1)[1].split(':')[0]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': args.width, 'height': args.height})
        for raw in args.cookie:
            name, _, value = raw.partition('=')
            context.add_cookies([{
                'name': name, 'value': value, 'domain': host, 'path': '/',
                'httpOnly': True, 'secure': False,
            }])
        page = context.new_page()
        errors: list[str] = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))

        for spec in args.shot:
            path, name, *rest = spec.split(':', 2)
            page.goto(f'{args.base}{path}', wait_until='domcontentloaded')
            page.wait_for_timeout(2000)
            for step in args.pre:
                verb, _, value = step.partition('=')
                if verb == 'fill':
                    page.get_by_role('combobox').first.fill(value)
                    page.keyboard.press('Enter')
                elif verb == 'click':
                    page.get_by_role('button', name=value).click()
                else:
                    raise SystemExit(f'unknown --pre step: {step}')
                page.wait_for_timeout(1500)
            page.wait_for_timeout(args.settle)
            if rest and rest[0]:
                page.get_by_role('tab', name=rest[0]).click()
                page.wait_for_timeout(args.settle)
            target = out / f'{name}.png'
            page.screenshot(path=str(target), animations='disabled', timeout=90_000)

            tables = page.evaluate("""() => [...document.querySelectorAll('table')].map(t => ({
              headers: [...t.querySelectorAll('th')].map(e => e.innerText.trim()).filter(Boolean),
              rows: [...t.querySelectorAll('tbody tr')].slice(0, 4).map(
                r => [...r.querySelectorAll('td')].map(c => c.innerText.replace(/\\n/g, ' / ')).join(' | ')),
            }))""")
            print(json.dumps({'shot': str(target), 'tables': tables}, indent=1))

        # Surfaced rather than swallowed: a screenshot of a page that threw looks fine.
        if errors:
            print('CONSOLE ERRORS:', json.dumps(errors[:10], indent=1))
        browser.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
