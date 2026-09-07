import { inflateSync } from 'node:zlib';

/**
 * Extracts the text drawn in a PDF.
 *
 * Used by the leak tests, which have to assert on what a client would actually
 * see on the page rather than on the object handed to the renderer.
 *
 * Content streams are Flate-compressed, and the renderer writes its strings as
 * hex rather than as literals, so both forms are decoded.
 *
 * The renderer positions each word run in its own BT/ET block, so a single
 * printed line arrives as several blocks. They are rejoined on the space the
 * text already carries at the break, and separated by a newline otherwise —
 * without that rule, either "7 September 2026" would come back broken, or two
 * unrelated lines would fuse into a match that appears on the page nowhere.
 */
export function extractPdfText(pdf: Buffer): string {
  const blocks: string[] = [];

  let index = 0;
  for (;;) {
    const start = pdf.indexOf('stream', index);
    if (start === -1) break;
    let from = start + 'stream'.length;
    if (pdf[from] === 0x0d) from += 1;
    if (pdf[from] === 0x0a) from += 1;

    const end = pdf.indexOf('endstream', from);
    if (end === -1) break;
    index = end + 'endstream'.length;

    let content: string;
    try {
      content = inflateSync(pdf.subarray(from, end)).toString('latin1');
    } catch {
      // Not a Flate stream — an embedded image, say. Nothing to read.
      continue;
    }

    for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
      blocks.push(readShownText(block[1]));
    }
  }

  return blocks.reduce((text, block, position) => {
    if (position === 0) return block;
    const continuesLine = text.endsWith(' ') || block.startsWith(' ');
    return continuesLine ? text + block : `${text}\n${block}`;
  }, '');
}

/** Reads the operands of the text-showing operators in one BT/ET block. */
function readShownText(block: string): string {
  const parts: string[] = [];

  // TJ takes an array of strings and kerning numbers; Tj takes a single string.
  for (const match of block.matchAll(/\[([\s\S]*?)\]\s*TJ|((?:\([\s\S]*?\))|(?:<[0-9a-fA-F\s]*>))\s*Tj/g)) {
    const operand = match[1] ?? match[2] ?? '';
    for (const token of operand.matchAll(/<([0-9a-fA-F\s]*)>|\(((?:\\.|[^\\)])*)\)/g)) {
      parts.push(token[1] !== undefined ? decodeHex(token[1]) : unescapeLiteral(token[2]));
    }
  }

  return parts.join('');
}

function decodeHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  const even = clean.length % 2 === 0 ? clean : `${clean}0`;
  let out = '';
  for (let i = 0; i < even.length; i += 2) {
    out += String.fromCharCode(parseInt(even.slice(i, i + 2), 16));
  }
  return out;
}

function unescapeLiteral(value: string): string {
  return value
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\([nrtbf()\\])/g, (_, char) => {
      const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      return map[char] ?? char;
    });
}

/** A4 in points, the only page size this template uses. */
const PAGE_HEIGHT = 841.89;

/**
 * Y positions at which the renderer placed something outside the page.
 *
 * react-pdf mis-measures some elements and then positions them thousands of
 * points away, producing a PDF that is structurally valid, contains all the
 * text, and shows a blank space where the element should be. Nothing about the
 * bytes says anything is wrong, so this reads the placement transforms back and
 * reports the ones that cannot be on the paper.
 */
export function offPagePlacements(pdf: Buffer): number[] {
  const found: number[] = [];

  let index = 0;
  for (;;) {
    const start = pdf.indexOf('stream', index);
    if (start === -1) break;
    let from = start + 'stream'.length;
    if (pdf[from] === 0x0d) from += 1;
    if (pdf[from] === 0x0a) from += 1;
    const end = pdf.indexOf('endstream', from);
    if (end === -1) break;
    index = end + 'endstream'.length;

    let content: string;
    try {
      content = inflateSync(pdf.subarray(from, end)).toString('latin1');
    } catch {
      continue;
    }

    for (const match of content.matchAll(/1 0 0 1 [\d.-]+ (-?[\d.]+) cm/g)) {
      const y = Number(match[1]);
      // The flip transform legitimately uses the page height itself.
      if (y === PAGE_HEIGHT || Math.abs(y - PAGE_HEIGHT) < 0.01) continue;
      if (y < -1 || y > PAGE_HEIGHT) found.push(y);
    }
  }

  return found;
}
