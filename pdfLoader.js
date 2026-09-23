const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

async function loadAndChunkPDF(pdfPath) {
  const resolvedPath = path.resolve(pdfPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`PDF not found at: ${resolvedPath}`);
  }

  console.log(`Loading PDF: ${resolvedPath}`);
  const data = await pdfParse(fs.readFileSync(resolvedPath));
  const fullText = data.text;
  console.log(`PDF loaded. Characters: ${fullText.length.toLocaleString()}`);

  const chunks = chunkText(fullText);
  console.log(`Split into ${chunks.length} chunks.`);
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
