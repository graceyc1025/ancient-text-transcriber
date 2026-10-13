import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import { KINDS, STATUS, txtContent, validXMLText } from './transcription.js';

export function exportTXT(project) {
  return new Blob([txtContent(project)], { type: 'text/plain;charset=utf-8' });
}

function textParagraph(text) {
  const runs = text.split('\n').map((line, index) => new TextRun({ text: line, break: index ? 1 : 0 }));
  return new Paragraph({ children: runs });
}

export async function exportDOCX(project, images = []) {
  if (images.length && images.length !== project.pages.length) throw new Error('图片数量与转录页数不一致。');
  const texts = [project.title, ...project.pages.flatMap(page => [page.filename, ...page.segments.map(segment => segment.text)])];
  if (!texts.every(validXMLText)) throw new Error('文字含 Word 无法保存的控制字符。请先导出 TXT 保留原文字，再清理控制字符。');
  const children = [
    new Paragraph({ text: project.title, heading: HeadingLevel.TITLE }),
    new Paragraph('说明：栏目标题为工具标签，不属于原文；换行保留识别列序；□为待确认字。附图为显示用副本，请另行保存原始文件。'),
  ];
  project.pages.forEach((page, index) => {
    children.push(new Paragraph({ text: `图像 ${String(index + 1).padStart(2, '0')} · ${page.filename}`, heading: HeadingLevel.HEADING_1, pageBreakBefore: index > 0 }));
    children.push(new Paragraph(`校对状态：${STATUS[page.status]}`));
    if (images.length) {
      const image = images[index], ratio = Math.min(576 / image.width, 620 / image.height);
      children.push(new Paragraph({ children: [new ImageRun({ data: image.data, type: 'png', transformation: { width: image.width * ratio, height: image.height * ratio }, altText: { name: page.filename, title: page.filename, description: `图像 ${index + 1} 对应原图` } })] }));
    }
    for (const segment of page.segments) {
      children.push(new Paragraph({ text: KINDS[segment.kind], heading: HeadingLevel.HEADING_2 }));
      children.push(textParagraph(segment.text));
    }
  });
  return Packer.toBlob(new Document({
    creator: '古籍转录助手',
    styles: { default: { document: { run: { font: '宋体', size: 24 } } } },
    sections: [{ children }],
  }));
}
