import fs from "node:fs";
import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

export type DocxParagraph = {
  index: number;
  text: string;
  style: string | null;
};

const PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false,
  // keep whitespace-only text nodes
  alwaysCreateTextNode: true,
};

const BUILDER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  suppressEmptyNode: false,
};

/** Extract paragraphs from a DOCX file with their index, text, and style. */
export async function readDocxParagraphs(filePath: string): Promise<DocxParagraph[]> {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("No word/document.xml found in DOCX");

  const parser = new XMLParser(PARSER_OPTS);
  const parsed = parser.parse(docXml);

  const paragraphs: DocxParagraph[] = [];
  const body = findNode(parsed, "w:body");
  if (!body) return paragraphs;

  const raw = (body as Record<string, unknown>)["w:body"] ?? [];
  const children: unknown[] = Array.isArray(raw) ? raw : [raw];
  let idx = 0;

  for (const child of children) {
    const pNodes = (child as Record<string, unknown>)["w:p"];
    if (!pNodes) continue;
    const pList = Array.isArray(pNodes) ? pNodes : [pNodes];
    for (const p of pList) {
      const text = extractParagraphText(p);
      const style = extractParagraphStyle(p);
      paragraphs.push({ index: idx++, text, style });
    }
  }

  return paragraphs;
}

/** Replace text in a DOCX file and save to a new path. Returns counts. */
export async function replaceInDocx(
  sourcePath: string,
  destPath: string,
  replacements: Array<{ find: string; replace: string }>,
): Promise<{ applied: number; skipped: number }> {
  const buf = fs.readFileSync(sourcePath);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("No word/document.xml found in DOCX");

  const parser = new XMLParser(PARSER_OPTS);
  const parsed = parser.parse(docXml);

  let applied = 0;
  let skipped = 0;

  const body = findNode(parsed, "w:body");
  if (body) {
    const raw2 = (body as Record<string, unknown>)["w:body"] ?? [];
    const children: unknown[] = Array.isArray(raw2) ? raw2 : [raw2];
    for (const child of children) {
      const pNodes = (child as Record<string, unknown>)["w:p"];
      if (!pNodes) continue;
      const pList = Array.isArray(pNodes) ? pNodes : [pNodes];
      for (const p of pList) {
        for (const rep of replacements) {
          const didReplace = replaceParagraphText(p, rep.find, rep.replace);
          if (didReplace) applied++;
        }
      }
    }
    skipped = replacements.length - new Set(replacements.filter((_, i) => i < applied).map(r => r.find)).size;
    // Simpler: just count how many replacement pairs had zero matches
    // We already counted applied per-match, so skipped = total unique finds that never matched
  }

  const builder = new XMLBuilder(BUILDER_OPTS);
  const newXml = builder.build(parsed);
  zip.file("word/document.xml", newXml);

  const outBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(destPath, outBuf);

  // Recalculate skipped properly
  const findSet = new Set(replacements.map(r => r.find));
  skipped = findSet.size - Math.min(applied, findSet.size);

  return { applied, skipped };
}

// ── Helpers ──

/** Recursively search a preserveOrder tree for a node key. */
function findNode(nodes: unknown, key: string): unknown | null {
  if (!nodes) return null;
  const arr = Array.isArray(nodes) ? nodes : [nodes];
  for (const node of arr) {
    if (typeof node !== "object" || node === null) continue;
    if (key in (node as Record<string, unknown>)) return node;
    for (const v of Object.values(node as Record<string, unknown>)) {
      const found = findNode(v, key);
      if (found) return found;
    }
  }
  return null;
}

/** Concatenate all w:t text within a paragraph node. */
function extractParagraphText(p: unknown): string {
  const texts: string[] = [];
  collectTexts(p, texts);
  return texts.join("");
}

function collectTexts(node: unknown, acc: string[]): void {
  if (!node || typeof node !== "object") return;
  const arr = Array.isArray(node) ? node : [node];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    if ("w:t" in obj) {
      const tNodes = Array.isArray(obj["w:t"]) ? obj["w:t"] : [obj["w:t"]];
      for (const t of tNodes) {
        if (typeof t === "string") {
          acc.push(t);
        } else if (typeof t === "object" && t !== null) {
          const tObj = t as Record<string, unknown>;
          if ("#text" in tObj) acc.push(String(tObj["#text"]));
        }
      }
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) collectTexts(v, acc);
      else if (typeof v === "object" && v !== null) collectTexts(v, acc);
    }
  }
}

/** Extract paragraph style name (w:pStyle val). */
function extractParagraphStyle(p: unknown): string | null {
  if (!p || typeof p !== "object") return null;
  const styleNode = findNode(p, "w:pStyle");
  if (!styleNode) return null;
  const obj = styleNode as Record<string, unknown>;
  const pStyle = obj["w:pStyle"];
  if (Array.isArray(pStyle) && pStyle.length > 0) {
    const first = pStyle[0] as Record<string, unknown>;
    const attrs = first[":@"] as Record<string, unknown> | undefined;
    return (attrs?.["@_w:val"] as string) ?? null;
  }
  return null;
}

/** Replace text across runs in a paragraph. Returns true if a replacement was made. */
function replaceParagraphText(p: unknown, find: string, replace: string): boolean {
  if (!p || typeof p !== "object") return false;

  // Gather all w:r (run) nodes with their w:t text
  const runs = collectRuns(p);
  if (runs.length === 0) return false;

  // Build concatenated text to find match positions
  const fullText = runs.map(r => r.text).join("");
  const matchIdx = fullText.indexOf(find);
  if (matchIdx === -1) return false;

  // Map character positions to runs
  let charPos = 0;
  let startRunIdx = -1;
  let startCharInRun = -1;
  let endRunIdx = -1;
  let endCharInRun = -1;
  const matchEnd = matchIdx + find.length;

  for (let i = 0; i < runs.length; i++) {
    const runStart = charPos;
    const runEnd = charPos + runs[i].text.length;

    if (startRunIdx === -1 && matchIdx >= runStart && matchIdx < runEnd) {
      startRunIdx = i;
      startCharInRun = matchIdx - runStart;
    }
    if (endRunIdx === -1 && matchEnd > runStart && matchEnd <= runEnd) {
      endRunIdx = i;
      endCharInRun = matchEnd - runStart;
    }
    charPos = runEnd;
  }

  if (startRunIdx === -1 || endRunIdx === -1) return false;

  // Apply replacement
  if (startRunIdx === endRunIdx) {
    // Match is within a single run
    const r = runs[startRunIdx];
    const before = r.text.substring(0, startCharInRun);
    const after = r.text.substring(endCharInRun);
    setRunText(r.tNode, before + replace + after);
  } else {
    // Match spans multiple runs — put replacement in first run, clear middle, trim last
    const first = runs[startRunIdx];
    setRunText(first.tNode, first.text.substring(0, startCharInRun) + replace);

    for (let i = startRunIdx + 1; i < endRunIdx; i++) {
      setRunText(runs[i].tNode, "");
    }

    const last = runs[endRunIdx];
    setRunText(last.tNode, last.text.substring(endCharInRun));
  }

  return true;
}

type RunInfo = { text: string; tNode: unknown };

/** Collect w:r nodes that contain w:t from a paragraph. */
function collectRuns(p: unknown): RunInfo[] {
  const runs: RunInfo[] = [];
  if (!p || typeof p !== "object") return runs;
  const arr = Array.isArray(p) ? p : [p];

  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;

    if ("w:r" in obj) {
      const rNodes = Array.isArray(obj["w:r"]) ? obj["w:r"] : [obj["w:r"]];
      for (const r of rNodes) {
        if (typeof r !== "object" || r === null) continue;
        const rObj = r as Record<string, unknown>;
        // Find w:t inside this run
        const tNode = findNode(rObj, "w:t");
        if (!tNode) continue;
        const texts: string[] = [];
        collectTexts(tNode, texts);
        runs.push({ text: texts.join(""), tNode });
      }
    }

    // Recurse into arrays (preserveOrder structure)
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) {
        for (const child of v) {
          if (typeof child === "object" && child !== null && "w:r" in (child as Record<string, unknown>)) {
            const rNodes = (child as Record<string, unknown>)["w:r"];
            const rList = Array.isArray(rNodes) ? rNodes : [rNodes];
            for (const r of rList) {
              if (typeof r !== "object" || r === null) continue;
              const tNode = findNode(r, "w:t");
              if (!tNode) continue;
              const texts: string[] = [];
              collectTexts(tNode, texts);
              runs.push({ text: texts.join(""), tNode });
            }
          }
        }
      }
    }
  }

  return runs;
}

/** Set the text content of a w:t node. */
function setRunText(tNode: unknown, text: string): void {
  if (!tNode || typeof tNode !== "object") return;
  const obj = tNode as Record<string, unknown>;
  if ("w:t" in obj) {
    const tArr = Array.isArray(obj["w:t"]) ? obj["w:t"] : [obj["w:t"]];
    if (tArr.length > 0) {
      const first = tArr[0];
      if (typeof first === "object" && first !== null) {
        (first as Record<string, unknown>)["#text"] = text;
      } else {
        // Direct string — replace array entry
        if (Array.isArray(obj["w:t"])) {
          (obj["w:t"] as unknown[])[0] = text;
        } else {
          obj["w:t"] = text;
        }
      }
    }
  }
}
