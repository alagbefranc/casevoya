# SRC-01: prints the text a dynamic (XFA) IRCC form PDF draws, for scripts/ops/capture-official-claims.mjs.
#
#   python3 -I scripts/ops/xfa-text.py form.pdf
#
# Most IRCC form PDFs are XFA forms: pdftotext only gets "Please wait...", and the edition stamp
# ("IMM 1294 (06-2026) E") lives in the form template. This prints, one per line, the template's
# drawn <text> values and rich-text <p> values, then the template's own version fields as
# "@variables.<name>=<value>" and "@desc.<name>=<value>". Read-only: it opens the one file given,
# runs nothing from it and writes nothing. Needs pypdf (pip install pypdf). Prints nothing for a
# PDF without XFA.
import html
import re
import sys

import pypdf

reader = pypdf.PdfReader(sys.argv[1])
acroform = reader.trailer["/Root"].get("/AcroForm")
xfa = acroform.get_object().get("/XFA") if acroform is not None else None
if xfa is None:
    sys.exit(0)
xfa = xfa.get_object()
if isinstance(xfa, list):
    parts = {str(xfa[i]): xfa[i + 1].get_object().get_data().decode("utf-8", "replace") for i in range(0, len(xfa) - 1, 2)}
else:
    parts = {"template": xfa.get_data().decode("utf-8", "replace")}
template = parts.get("template", "")

for draw in re.finditer(r"<draw\b[\s\S]*?</draw\s*>", template):
    for text, para in re.findall(r"<text\b[^>]*>([^<]*)</text\s*>|<p\b[^>]*>([^<]*)</p\s*>", draw.group(0)):
        value = html.unescape(text or para).strip()
        if value:
            print(value)

for block in ("variables", "desc"):
    for body in re.findall(rf"<{block}\b[^>]*>([\s\S]*?)</{block}\s*>", template):
        for name, value in re.findall(r'<text\s+name="([^"]+)"\s*>([^<]*)</text\s*>', body):
            print(f"@{block}.{name}={html.unescape(value).strip()}")
