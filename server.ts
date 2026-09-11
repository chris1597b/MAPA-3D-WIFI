import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Body parser for JSON and base64 images (up to 50mb for video frames/point clouds)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Lazy Gemini client
let genAI: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing");
    }
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "lingbot-map-3d-live",
    timestamp: new Date().toISOString(),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// Proxy to test LingBot-Map server connectivity
app.post("/api/lingbot/check-server", async (req, res) => {
  const { serverUrl } = req.body;
  if (!serverUrl || typeof serverUrl !== "string") {
    return res.status(400).json({ error: "serverUrl is required" });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const target = serverUrl.replace(/\/$/, "");
    const response = await fetch(`${target}/health`, {
      signal: controller.signal,
    }).catch(async () => {
      // try root endpoint
      return await fetch(`${target}/`, { signal: controller.signal });
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json().catch(() => ({ status: "online" }));
      return res.json({ connected: true, data });
    } else {
      return res.json({ connected: false, status: response.status });
    }
  } catch (err: any) {
    return res.json({
      connected: false,
      error: err?.name === "AbortError" ? "Timeout de conexión" : err?.message || "No responde",
    });
  }
});

// Proxy forward frame to external LingBot-Map server
app.post("/api/lingbot/stream-frame", async (req, res) => {
  const { serverUrl, frameData, intrinsics, timestamp } = req.body;
  if (!serverUrl) {
    return res.status(400).json({ error: "serverUrl is required" });
  }

  try {
    const target = serverUrl.replace(/\/$/, "");
    const response = await fetch(`${target}/api/process_frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: frameData, // base64
        intrinsics: intrinsics || null,
        timestamp: timestamp || Date.now(),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    return res.status(502).json({
      error: "Error forwarding to LingBot server: " + (err?.message || "Unknown error"),
    });
  }
});

// AI Semantic Scene Labeling using Gemini Vision
app.post("/api/gemini/analyze-scene", async (req, res) => {
  try {
    const { imageBase64, cameraPose } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    // Clean base64 header if present
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const client = getGeminiClient();
    const prompt = `Analiza esta imagen capturada por la cámara del celular durante un escaneo 3D con LingBot-Map.
Identifica los 3 a 5 objetos o elementos espaciales principales del entorno (ej. Mesa, Silla, Ventana, Puerta, Laptop, Planta, Pared, Suelo).
Devuelve un JSON estrictamente en este formato:
{
  "sceneType": "habitación / oficina / exterior / sala / pasillo",
  "description": "Breve descripción del entorno",
  "objects": [
    {
      "name": "Nombre del objeto",
      "category": "mueble | electrónica | estructura | decoración | obstáculo",
      "estimatedDistanceMeters": 1.5,
      "relativePosition": "centro | izquierda | derecha | fondo | primer plano",
      "confidence": 0.95
    }
  ]
}
No incluyas formato markdown adicional excepto el JSON válido.`;

    const response = await client.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: cleanBase64,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    const responseText = response.text || "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = { raw: responseText };
    }

    return res.json({
      success: true,
      analysis: parsed,
      cameraPose: cameraPose || null,
    });
  } catch (err: any) {
    console.error("Gemini analysis error:", err);
    return res.status(500).json({
      error: "Error al analizar la escena: " + (err?.message || "Error desconocido"),
    });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`LingBot 3D Live Map server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
