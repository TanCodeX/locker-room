import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { getPersona } from "./personas";

dotenv.config();

const app = express();
const PORT = 3000;

// Support JSON parsing
app.use(express.json());

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

async function performSpeech(text: string, voiceId: string): Promise<string> {
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
  return buffer.toString("base64");
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

    const speechText = await writeSpeech(input, persona.vibe);
    const audioBase64 = await performSpeech(speechText, persona.voiceId);

    // Ensure the frontend receives the correct base64 data URI format
    res.json({
      text: speechText,
      audio: `data:audio/mpeg;base64,${audioBase64}`,
    });
  } catch (error: any) {
    console.error("Pep talk generation error:", error);
    res.status(500).json({ error: error.message || "Something went wrong backstage." });
  }
});

// Configure Vite middleware or serve static build
async function setupVite() {
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
}

setupVite().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Locker Room server running on http://localhost:${PORT}`);
  });
});
