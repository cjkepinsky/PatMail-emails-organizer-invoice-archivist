type EmailPdfInput = {
  title: string;
  headerLines: string[];
  body: string;
};

const pageWidth = 595;
const pageHeight = 842;
const margin = 48;
const lineHeight = 14;
const fontSize = 10;
const maxCharsPerLine = 92;
const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);

export function renderEmailPdf(input: EmailPdfInput) {
  const lines = wrapLines([
    input.title,
    "",
    ...input.headerLines,
    "",
    ...input.body.split(/\r?\n/)
  ]);
  const pages = chunk(lines, linesPerPage);
  const objects: string[] = [];

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids ${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")} /Count ${pages.length} >>`);

  pages.forEach((pageLines, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentObjectId} 0 R >>`
    );
    const content = renderPageContent(pageLines);
    objects.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  });

  return Buffer.from(buildPdf(objects), "latin1");
}

function renderPageContent(lines: string[]) {
  const commands = ["BT", `/F1 ${fontSize} Tf`, `${margin} ${pageHeight - margin} Td`, `${lineHeight} TL`];
  for (const line of lines) {
    commands.push(`(${escapePdfText(toPdfText(line))}) Tj`, "T*");
  }
  commands.push("ET");
  return commands.join("\n");
}

function wrapLines(lines: string[]) {
  const output: string[] = [];
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized) {
      output.push("");
      continue;
    }

    let current = "";
    for (const word of normalized.split(" ")) {
      if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= maxCharsPerLine) {
        current = `${current} ${word}`;
      } else {
        output.push(current);
        current = word;
      }
    }
    if (current) output.push(current);
  }
  return output.length ? output : [""];
}

function chunk<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output.length ? output : [[]];
}

function buildPdf(objects: string[]) {
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return body;
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function toPdfText(value: string) {
  return value
    .replace(/[ąćęłńóśźż]/g, match => polishAscii[match] || match)
    .replace(/[ĄĆĘŁŃÓŚŹŻ]/g, match => polishAscii[match] || match)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ");
}

const polishAscii: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
  Ą: "A",
  Ć: "C",
  Ę: "E",
  Ł: "L",
  Ń: "N",
  Ó: "O",
  Ś: "S",
  Ź: "Z",
  Ż: "Z"
};
