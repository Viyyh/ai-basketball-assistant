"""Render the versioned Chinese shooting guide; requires reportlab and a CJK TTF."""
import argparse
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
ROOT = Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--font', default='/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
    p.add_argument('--out', default=str(ROOT / 'output/pdf/shooting-task-v2.pdf'))
    args = p.parse_args()
    pdfmetrics.registerFont(TTFont('GuideCJK', args.font))
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    body = ParagraphStyle('body', fontName='GuideCJK', fontSize=12, leading=21, wordWrap='CJK', spaceAfter=14, textColor=colors.HexColor('#25364A'), alignment=TA_LEFT)
    heading = ParagraphStyle('heading', parent=body, fontSize=20, leading=29, spaceAfter=23, textColor=colors.HexColor('#123653'))
    small = ParagraphStyle('small', parent=body, fontSize=10, leading=16, textColor=colors.HexColor('#64748B'))
    story = []
    pages = (ROOT / 'docs/video-delivery-spec.md').read_text().split('<!-- page -->')
    for index, page in enumerate(pages):
        if index: story.append(PageBreak())
        story.append(Paragraph('AI BASKETBALL ASSISTANT · 实拍采集 v2.0', small))
        story.append(Spacer(1, 14))
        for paragraph in page.strip().split('\n\n'):
            paragraph = paragraph.strip()
            if paragraph.startswith('# '):
                story.append(Paragraph(escape(paragraph[2:]), heading))
                continue
            is_heading = paragraph.startswith('## ')
            story.append(Paragraph(escape(paragraph.removeprefix('## ')).replace('\n', '<br/>'), heading if is_heading else body))
    def footer(canvas, doc):
        canvas.setStrokeColor(colors.HexColor('#CBD5E1'))
        canvas.line(42, 40, 553, 40)
        canvas.setFont('GuideCJK', 9)
        canvas.setFillColor(colors.HexColor('#64748B'))
        canvas.drawString(42, 26, '2026-11-01 · 先试拍，再采集；未知不猜测')
        canvas.drawRightString(553, 26, f'{doc.page} / {len(pages)}')
    SimpleDocTemplate(str(target), pagesize=(595.28,841.89), rightMargin=42, leftMargin=42, topMargin=40, bottomMargin=55, title='篮球实拍素材任务书 v2.0', author='AI Basketball Assistant').build(story, onFirstPage=footer, onLaterPages=footer)
    print(target)
if __name__ == '__main__':
    main()
