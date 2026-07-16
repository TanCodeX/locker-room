import express from "express";
import path from "path";
import dotenv from "dotenv";
import { getPersona } from "./personas";
import { GoogleGenAI, Modality } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// Support JSON parsing
app.use(express.json());

function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000): Buffer {
  const header = Buffer.alloc(44);
  const dataLength = pcmBuffer.length;
  const fileLength = dataLength + 36;
  header.write("RIFF", 0);
  header.writeUInt32LE(fileLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function writeSpeech(userInput: string, vibe: string): Promise<string> {
  const prompt = `You are ghostwriting a short pre-game locker-room pep talk.

PERSONA: ${vibe}

The user is passionate about: "${userInput}"

Write a 30-60 second spoken pep talk (roughly 120-180 words) in this persona's
voice, directed at the user, about the thing they just described. Make it feel
personal — reference specifics from what they wrote, don't be generic.

Build in intensity across three beats: (1) acknowledge the struggle or stakes,
(2) remind them why they started and what they're capable of, (3) send them
out the door fired up.

Embed ElevenLabs v3 audio tags inline to direct the vocal performance — for
example [whispers], [shouts], [laughs], [sighs], [sarcastically]. Use them
sparingly and purposefully, 3 to 6 total, only where the emotional shift
actually happens.

Output ONLY the speech text with inline tags. No title, no markdown, no
explanation, no quotation marks wrapping the whole thing.`;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY as string,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini couldn't write the speech (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned an empty speech. Try rephrasing your input.");

  // eleven_v3 caps requests at ~3,000 characters — trim defensively.
  return text.trim().slice(0, 2800);
}

async function generateCassetteArtSVG(intent: string, color: string): Promise<string> {
  const prompt = `You are an expert SVG artist. Create a completely valid, standalone, highly stylized, retro cassette tape label SVG.
The artwork should represent this intense scenario/passion: "${intent}".
Use a strict retro-synthwave or vintage aesthetic. The primary accent color must be "${color}".
Include stylized vector shapes, lightning bolts, or minimalist abstract sports/hustle elements.
The SVG dimensions should be 400x150. Use a dark background like #1a1a1a.
CRITICAL: Do not wrap the SVG in markdown backticks. Return ONLY the raw <svg>...</svg> code starting with <svg> and ending with </svg>. Do not include any HTML or explanations.`;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY as string,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!res.ok) {
    console.error("SVG Gen error:", await res.text());
    return ""; // fail silently and just don't show the art if it fails
  }

  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return "";
  
  // Clean up potential markdown formatting just in case
  let svg = text.trim();
  if (svg.startsWith("\`\`\`xml")) svg = svg.replace("\`\`\`xml", "");
  if (svg.startsWith("\`\`\`svg")) svg = svg.replace("\`\`\`svg", "");
  if (svg.startsWith("\`\`\`html")) svg = svg.replace("\`\`\`html", "");
  if (svg.startsWith("\`\`\`")) svg = svg.replace("\`\`\`", "");
  if (svg.endsWith("\`\`\`")) svg = svg.slice(0, -3);
  
  return svg.trim();
}

async function performSpeech(text: string, voiceId: string): Promise<{ audioBase64: string, format: string }> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY as string,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_v3",
      voice_settings: { stability: 0.4, similarity_boost: 0.8 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `ElevenLabs couldn't perform the speech (${res.status}): ${detail.slice(0, 300)}`
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { audioBase64: buffer.toString("base64"), format: "audio/mpeg" };
}

// API endpoint to generate the pep talk
app.post("/api/peptalk", async (req, res) => {
  try {
    const input = typeof req.body?.intent === "string" ? req.body.intent.trim() : "";
    const personaId = req.body?.persona;

    if (input.length < 3) {
      return res.status(400).json({ error: "Tell it what you're walking into first." });
    }
    if (input.length > 500) {
      return res.status(400).json({ error: "Keep it under 500 characters — give the coach a headline, not a novel." });
    }

    const persona = getPersona(personaId);
    if (!persona) {
      return res.status(400).json({ error: "Pick a coach first." });
    }

    if (!process.env.GEMINI_API_KEY || !process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({
        error: "Missing API keys on the server. Add GEMINI_API_KEY and ELEVENLABS_API_KEY to .env and restart the dev server.",
      });
    }

    // Get accent color for the SVG
    let personaColor = "#fbbc00"; // default coach amber
    if (personaId === "bestie") personaColor = "#ffb0d0";
    if (personaId === "narrator") personaColor = "#ff4e50";
    if (personaId === "sergeant") personaColor = "#abc7ff";

    // Run both text generation and SVG art generation concurrently
    const [speechText, artSvg] = await Promise.all([
      writeSpeech(input, persona.vibe),
      generateCassetteArtSVG(input, personaColor)
    ]);
    
    let audioDataUri = "";

    try {
      const { audioBase64, format } = await performSpeech(speechText, persona.voiceId);
      audioDataUri = `data:${format};base64,${audioBase64}`;
    } catch (err: any) {
      console.warn("ElevenLabs TTS failed, falling back to Gemini TTS. Error:", err.message);
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
      
      let voiceName = "Kore";
      if (personaId === "bestie") voiceName = "Puck";
      if (personaId === "narrator") voiceName = "Zephyr";
      if (personaId === "sergeant") voiceName = "Fenrir";

      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: speechText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const rawPcmBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (rawPcmBase64) {
        const pcmBuffer = Buffer.from(rawPcmBase64, "base64");
        const wavBuffer = pcmToWav(pcmBuffer, 24000);
        audioDataUri = `data:audio/wav;base64,${wavBuffer.toString("base64")}`;
      }
    }

    // Ensure the frontend receives the correct base64 data URI format and art SVG
    res.json({
      text: speechText,
      audio: audioDataUri,
      artSvg: artSvg
    });
  } catch (error: any) {
    console.error("Pep talk generation error:", error);
    res.status(500).json({ error: error.message || "Something went wrong backstage." });
  }
});

// Configure Vite middleware or serve static build
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const viteModule = await import("vite");
    const vite = await viteModule.createServer({
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
}

// Only run the dev/static server if NOT on Vercel
if (!process.env.VERCEL) {
  setupVite().then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Locker Room server running on http://localhost:${PORT}`);
    });
  });
}

// Export the Express app for Vercel Serverless Functions
export default app;
