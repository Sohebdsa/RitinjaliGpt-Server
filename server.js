require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { loadAndChunkPDF } = require("./pdfLoader");
const { initSearch, indexChunks, searchChunks } = require("./search");

const { GEMINI_API_KEY, PORT = 5001, PDF_PATH, FRONTEND_URL } = process.env;

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is missing in .env");
  process.exit(1);
}
if (!PDF_PATH) {
  console.error("PDF_PATH is missing in .env");
  process.exit(1);
}

const app = express();

// Support comma-separated list of allowed origins e.g. "https://app.vercel.app,https://staging.vercel.app"
const allowedOrigins = (FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes("*") ||
      allowedOrigins.includes(origin) ||
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1")
    ) {
      return callback(null, true);
    }
    callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST"],
}));

app.use(express.json());

// Gemini models to try in order (newest first)
const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
];

let activeModel = null;

async function callGemini(systemPrompt, userPrompt) {
  const modelsToTry = activeModel ? [activeModel] : GEMINI_MODELS;

  for (const model of modelsToTry) {
    const urls = [
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    ];

    for (const url of urls) {
      const version = url.includes("/v1beta/") ? "v1beta" : "v1";
      console.log(`Trying ${model} (${version})...`);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const msg = err?.error?.message || `HTTP ${res.status}`;
          if (res.status === 404 || res.status === 400) {
            console.log(`  Skipping ${model}: ${msg.substring(0, 80)}`);
            break;
          }
          throw new Error(msg);
        }

        const data = await res.json();
        const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!answer) throw new Error("Empty response from Gemini");

        if (!activeModel) {
          activeModel = model;
          console.log(`Active model: ${model} (${version})`);
        }

        return answer;
      } catch (err) {
        if (!err.message.startsWith("HTTP") && !err.message.includes("model")) throw err;
        console.log(`  Error: ${err.message.substring(0, 80)}`);
      }
    }
  }

  throw new Error(
    "No Gemini model available. Check your API key at https://aistudio.google.com/app/apikey"
  );
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", port: PORT, model: activeModel || "detecting" });
});

app.post("/api/chat", async (req, res) => {
  const { question, history = [] } = req.body;

  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "Question is required." });
  }

  try {
    const chunks = await searchChunks(question.trim(), 4);
    const context = chunks.join("\n\n---\n\n");

    const systemPrompt = `You are a support assistant for the Ritinjali platform.
Answer questions ONLY using the MANUAL CONTEXT provided below.
Do not use any external knowledge or training data.
If the answer is not in the context, say: "I can only answer questions based on the Ritinjali User Manual. This topic is not covered in it."
Be concise and clear. Use bullet points or numbered steps when helpful.

MANUAL CONTEXT:
${context}`;

    const historyText = history
      .slice(-6)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n");

    const userPrompt = historyText
      ? `${historyText}\nUser: ${question}`
      : question;

    const answer = await callGemini(systemPrompt, userPrompt);
    res.json({ answer });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

async function start() {
  console.log("Starting Ritinjali Chatbot API...");

  try {
    initSearch();
    const chunks = await loadAndChunkPDF(PDF_PATH);
    await indexChunks(chunks);

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start:", err.message);
    process.exit(1);
  }
}

start();
