const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","will","would","could","should","may","might",
  "shall","this","that","these","those","it","its","i","you","we","they",
  "he","she","my","your","our","their","what","which","who","how","when",
  "where","if","then","so","as","also","not","no","can","just","more",
]);

let chunkStore = [];
let idfMap = {};
let indexed = false;

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function computeTF(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const len = tokens.length || 1;
  for (const t in tf) tf[t] /= len;
  return tf;
}

function computeNorm(map) {
  return Math.sqrt(Object.values(map).reduce((s, v) => s + v * v, 0));
}

function initSearch() {}

async function indexChunks(chunks) {
  console.log(`Indexing ${chunks.length} chunks...`);
  chunkStore = [];
  idfMap = {};

  const allTFs = chunks.map((chunk) => ({
    chunk,
    termFreqs: computeTF(tokenize(chunk)),
  }));

  const N = chunks.length;
  const docFreq = {};
  for (const { termFreqs } of allTFs) {
    for (const term of Object.keys(termFreqs)) {
      docFreq[term] = (docFreq[term] || 0) + 1;
    }
  }
  for (const term in docFreq) {
    idfMap[term] = Math.log((N + 1) / (docFreq[term] + 1)) + 1;
  }

  for (const { chunk, termFreqs } of allTFs) {
    const tfidf = {};
    for (const [term, tf] of Object.entries(termFreqs)) {
      tfidf[term] = tf * (idfMap[term] || 1);
    }
    chunkStore.push({ chunk, tfidf, norm: computeNorm(tfidf) });
  }

  indexed = true;
  console.log(`Indexed ${chunkStore.length} chunks.`);
}

async function searchChunks(query, topK = 4) {
  if (!indexed || chunkStore.length === 0) {
    throw new Error("Chunks not indexed yet.");
  }

  const qTF = computeTF(tokenize(query));
  const qTFIDF = {};
  for (const [term, tf] of Object.entries(qTF)) {
    qTFIDF[term] = tf * (idfMap[term] || 0.5);
  }
  const qNorm = computeNorm(qTFIDF);

  if (qNorm === 0) {
    return chunkStore.slice(0, topK).map((c) => c.chunk);
  }

  const scored = chunkStore.map(({ chunk, tfidf, norm }) => {
    let dot = 0;
    for (const [term, qW] of Object.entries(qTFIDF)) {
      if (tfidf[term]) dot += qW * tfidf[term];
    }
    return { chunk, score: norm > 0 ? dot / (qNorm * norm) : 0 };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.chunk);
}

module.exports = { initSearch, indexChunks, searchChunks };
