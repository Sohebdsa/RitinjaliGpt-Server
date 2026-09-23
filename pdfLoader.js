const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

async function loadAndChunkPDF(pdfPath) {
  // 1. First, check if pre-extracted chunks.json exists
  const jsonCandidates = [
    path.join(__dirname, "manual", "chunks.json"),
    path.join(process.cwd(), "manual", "chunks.json"),
    path.join(process.cwd(), "server", "manual", "chunks.json"),
    path.join(path.dirname(pdfPath || ""), "chunks.json"),
  ];

  for (const jsonPath of jsonCandidates) {
    if (jsonPath && fs.existsSync(jsonPath)) {
      try {
        console.log(`Loading pre-extracted chunks from: ${jsonPath}`);
        const raw = fs.readFileSync(jsonPath, "utf-8");
        const chunks = JSON.parse(raw);
        if (Array.isArray(chunks) && chunks.length > 0) {
          console.log(`Loaded ${chunks.length} chunks instantly from JSON.`);
          return chunks;
        }
      } catch (err) {
        console.warn(`Failed reading ${jsonPath}, falling back to PDF:`, err.message);
      }
    }
  }

  // 2. Fallback: Parse the PDF file
  const candidatePaths = [
    pdfPath,
    path.isAbsolute(pdfPath) ? pdfPath : path.join(__dirname, pdfPath),
    path.join(__dirname, "manual", "Ritinjali_User_manual_v2.pdf"),
    path.join(process.cwd(), "manual", "Ritinjali_User_manual_v2.pdf"),
    path.join(process.cwd(), "server", "manual", "Ritinjali_User_manual_v2.pdf"),
  ];

  let resolvedPath = null;
  for (const candidate of candidatePaths) {
    if (candidate && fs.existsSync(candidate)) {
      resolvedPath = candidate;
      break;
    }
  }

  if (!resolvedPath) {
    throw new Error(`PDF not found. Checked locations: ${candidatePaths.filter(Boolean).join(", ")}`);
  }

  console.log(`Loading PDF: ${resolvedPath}`);
  const data = await pdfParse(fs.readFileSync(resolvedPath));
  const fullText = data.text;
  console.log(`PDF loaded. Characters: ${fullText.length.toLocaleString()}`);

  const chunks = chunkText(fullText);
  console.log(`Split into ${chunks.length} chunks.`);

  // Auto-save chunks.json so next startup loads in ~5ms
  try {
    const saveDir = path.dirname(resolvedPath);
    const savePath = path.join(saveDir, "chunks.json");
    fs.writeFileSync(savePath, JSON.stringify(chunks, null, 2), "utf-8");
    console.log(`Cached chunks to: ${savePath}`);
  } catch (err) {
    // Non-critical if write fails (e.g. read-only filesystem)
  }

  return chunks;
}

function chunkText(text, chunkSize = 1500, overlap = 300) {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  const chunks = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = start + chunkSize;

    if (end < cleaned.length) {
      const boundary = Math.max(
        cleaned.lastIndexOf(".", end),
        cleaned.lastIndexOf("\n", end)
      );
      if (boundary > start + chunkSize * 0.5) {
        end = boundary + 1;
      }
    }

    const chunk = cleaned.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);

    start = end - overlap;
  }

  return chunks;
}

module.exports = { loadAndChunkPDF };
