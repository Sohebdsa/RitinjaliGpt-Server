require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { loadAndChunkPDF } = require("./pdfLoader");
const { initSearch, indexChunks, searchChunks } = require("./search");

const { GEMINI_API_KEY, PORT = 5001 } = process.env;

const PDF_PATH = process.env.PDF_PATH
  ? (path.isAbsolute(process.env.PDF_PATH)
    ? process.env.PDF_PATH
    : path.join(__dirname, process.env.PDF_PATH))
  : path.join(__dirname, "manual", "Ritinjali_User_manual_v2.pdf");

const app = express();

// Universal CORS configuration - allows any origin (Vercel preview, production, localhost)
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.options("*", cors());
app.use(express.json());

// Root test route
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Ritinjali Chatbot API is operational",
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
  });
});

const GEMINI_MODELS = [
  "gemini-1.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
];

let activeModel = "gemini-1.5-flash";

async function callGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Please add it to your environment variables."
    );
  }

  const modelsToTry = [activeModel, ...GEMINI_MODELS.filter((m) => m !== activeModel)];

  for (const model of modelsToTry) {
    const urls = [
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    ];

    for (const url of urls) {
      const version = url.includes("/v1beta/") ? "v1beta" : "v1";
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
            console.log(`Skipping ${model}: ${msg.substring(0, 80)}`);
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
        console.log(`Error with ${model}: ${err.message.substring(0, 80)}`);
      }
    }
  }

  throw new Error("No Gemini model available for this API key.");
}

// Lazy initialization — cached across warm serverless invocations
let initialized = false;
let initError = null;

async function ensureInitialized() {
  if (initialized) return;
  if (initError) throw initError;

  try {
    console.log("Loading and indexing PDF...");
    initSearch();
    const chunks = await loadAndChunkPDF(PDF_PATH);
    await indexChunks(chunks);
    initialized = true;
    console.log("Ready. Indexed chunks:", chunks.length);
  } catch (err) {
    initError = err;
    console.error("Initialization error:", err);
    throw err;
  }
}

app.get("/api/health", async (req, res) => {
  try {
    await ensureInitialized();
    res.json({
      status: "ok",
      model: activeModel || "detecting",
      apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  } catch (err) {
    console.error("Health check error:", err.message);
    res.status(500).json({
      status: "error",
      message: err.message,
      apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const { question, history = [] } = req.body;

  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "Question is required." });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error:
        "GEMINI_API_KEY is not configured on the server. Please add it in your Vercel Project Settings > Environment Variables.",
    });
  }

  try {
    await ensureInitialized();

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

    const userPrompt = historyText ? `${historyText}\nUser: ${question}` : question;

    const answer = await callGemini(systemPrompt, userPrompt);
    res.json({ answer });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: err.message || "Something went wrong. Please try again." });
  }
});

// Express global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// Local development server
if (require.main === module) {
  if (!GEMINI_API_KEY) {
    console.warn("WARNING: GEMINI_API_KEY is not set in .env");
  }
  ensureInitialized()
    .then(() => {
      app.listen(PORT, () =>
        console.log(`Server running on http://localhost:${PORT}`)
      );
    })
    .catch((err) => {
      console.error("Failed to start locally:", err.message);
      process.exit(1);
    });
}

module.exports = app;
