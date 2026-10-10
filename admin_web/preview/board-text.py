"""Prints the visible text of a design board, in order: python3 -I preview/board-text.py AdmReceipts"""
import html, re, sys, pathlib
root = pathlib.Path(__file__).resolve().parents[2] / 'docs' / 'canvas'
for name in sys.argv[1:]:
    s = (root / f'{name}.dc.html').read_text(encoding='utf8')
    s = re.sub(r'<svg.*?</svg>', '', s, flags=re.S)
    s = re.sub(r'<(style|script|head)\b.*?</\1>', '', s, flags=re.S)
    text = html.unescape(re.sub(r'<[^>]+>', '\n', s))
    print(f'===== {name}')
    print('\n'.join(l.strip() for l in text.split('\n') if l.strip()))
