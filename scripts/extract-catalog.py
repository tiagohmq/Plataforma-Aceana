"""Gera src/db/seeds/catalog-v0.json a partir do 05_Catalogo_Semente_v0.xlsx da KB.

Uso: python -I scripts/extract-catalog.py <caminho do xlsx> <saida.json>
Só biblioteca padrão. Ignora a coluna "Multiplicador de complexidade" (corrompida em datas do Excel)
e usa só "Complexidade"; o multiplicador vem da tabela de parâmetros.
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
STAGES = [('I', 'Start'), ('J', 'Imersão'), ('K', 'Ideação'), ('L', 'Acompanhamento')]


def cells(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    out = {}
    for c in sheet.iter('{%s}c' % NS['m']):
        v = c.find('m:v', NS)
        if v is None or v.text is None:
            continue
        out[c.get('r')] = shared[int(v.text)] if c.get('t') == 's' else v.text
    return out


def main(src, dst):
    c = cells(src)
    rows = sorted({int(re.sub(r'\D', '', k)) for k in c if k.startswith('A')})
    solutions = []
    for r in rows:
        code = c.get(f'A{r}', '')
        if not code.startswith('SOL-'):
            continue
        stages = []
        for col, name in STAGES:
            raw = c.get(f'{col}{r}')
            if raw not in (None, ''):
                try:
                    stages.append({'name': name, 'days': int(float(raw))})
                except ValueError:
                    pass
        solutions.append({
            'code': code,
            'name': c.get(f'B{r}', '').strip(),
            'front': c.get(f'C{r}', '').strip(),
            'complexity': int(float(c.get(f'D{r}', '0') or 0)),
            'stages': stages,
            'note': c.get(f'R{r}', '').strip(),
        })
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(solutions, f, ensure_ascii=False, indent=1)
    print(f'{len(solutions)} soluções -> {dst}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
