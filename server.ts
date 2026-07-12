import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Lazy initialize Gemini API client to prevent crashing on startup if key is missing
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in the Settings > Secrets panel.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Support JSON parsing
app.use(express.json());

// Helper to convert 16-bit Mono PCM (24kHz) to a standard WAV file
function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000): Buffer {
  const header = Buffer.alloc(44);
  const dataLength = pcmBuffer.length;
  const fileLength = dataLength + 36;

  // RIFF identifier
  header.write("RIFF", 0);
  // file length
  header.writeUInt32LE(fileLength, 4);
  // WAVE identifier
  header.write("WAVE", 8);
  // format chunk identifier
  header.write("fmt ", 12);
  // format chunk length
  header.writeUInt32LE(16, 16);
  // sample format (raw pcm)
  header.writeUInt16LE(1, 20);
  // channel count
  header.writeUInt16LE(1, 22);
  // sample rate
  header.writeUInt32LE(sampleRate, 24);
  // byte rate (sample rate * block align)
  header.writeUInt32LE(sampleRate * 2, 28);
  // block align (channel count * bytes per sample)
  header.writeUInt16LE(2, 32);
  // bits per sample
  header.writeUInt16LE(16, 34);
  // data chunk identifier
  header.write("data", 36);
  // data chunk length
  header.writeUInt32LE(dataLength, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// API endpoint to generate the pep talk
app.post("/api/peptalk", async (req, res) => {
  try {
    const { intent, persona } = req.body;
    
    if (!intent || !persona) {
      return res.status(400).json({ error: "Intent and Persona are required parameters." });
    }

    const ai = getAiClient();

    // Map persona to its prompt styling & TTS voice config
    let promptStyling = "";
    let voiceName: "Kore" | "Fenrir" | "Puck" | "Zephyr" = "Kore";
    let voiceTone = "";

    switch (persona) {
      case "coach":
        voiceName = "Kore";
        voiceTone = "gruff, tough-love, direct, old-school coach";
        promptStyling = `You are a legendary, hard-nosed, old-school athletic coach. You speak with tough love, absolute authority, and grit. Use short, punchy, active sentences. You don't sugarcoat anything. You push them because you know they have greatness in them. Speak directly to them. Keep it between 50 and 70 words.`;
        break;
      case "bestie":
        voiceName = "Puck";
        voiceTone = "super energetic, hyped-up, loyal best friend";
        promptStyling = `You are the ultimate ride-or-die best friend. You are incredibly hyped, personal, supportive, loud, and full of positive energy. Use casual language, modern slang if appropriate, and absolute belief. You are their biggest fan. Keep it between 50 and 70 words.`;
        break;
      case "narrator":
        voiceName = "Zephyr";
        voiceTone = "deep, cinematic, dramatic movie-trailer narrator";
        promptStyling = `You are a deep, cinematic, epic movie-trailer narrator. Speak of this situation as a high-stakes, once-in-a-lifetime quest. Use grand metaphors, dramatic pauses, and intense gravity. Paint them as the hero standing on the precipice of destiny. Keep it between 50 and 70 words.`;
        break;
      case "sergeant":
        voiceName = "Fenrir";
        voiceTone = "military-grade drill sergeant, intense and relentless";
        promptStyling = `You are a relentless, high-intensity military drill sergeant. Speak with extreme urgency, discipline, and roaring energy. Demand focus, strength, and complete commitment. You do not tolerate hesitation or excuses. It is time to execute. Keep it between 50 and 70 words.`;
        break;
      default:
        voiceName = "Kore";
        voiceTone = "motivational speaker";
        promptStyling = `You are an elite, focused motivational speaker. Speak with high-energy belief and absolute focus. Keep it between 50 and 70 words.`;
    }

    // 1. Generate text transcript of the pep talk
    const textPrompt = `Draft a direct, highly customized pep talk for someone about to walk into this specific situation: "${intent}".
Follow these instructions perfectly:
- Speak in the style of: ${promptStyling}.
- Make it extremely relevant to their exact scenario ("${intent}").
- Keep the length strictly between 50 and 70 words.
- Do not use markdown styling like asterisks, bullet points, or section titles. Just return the clean, spoken text itself.`;

    const textResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: textPrompt,
      config: {
        systemInstruction: "You are an elite motivational specialist in the Locker Room. You craft highly specific, high-stakes, spoken pep talks. You never output markdown tags, list formatting, asterisks, or labels. You output only raw, speakable words.",
        temperature: 0.85,
      },
    });

    const pepTalkText = textResponse.text?.trim() || "Listen up. This is your moment. You have prepared for this. Now step out there and take what's yours!";

    // 2. Synthesize generated text to speech using gemini-3.1-flash-tts-preview
    let base64Wav = "";
    try {
      const ttsPrompt = `Speak this exact text with a ${voiceTone} voice. Do not add any greeting or meta-commentary, just speak the words: "${pepTalkText}"`;
      
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: ttsPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName },
            },
          },
        },
      });

      const rawPcmBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (rawPcmBase64) {
        const pcmBuffer = Buffer.from(rawPcmBase64, "base64");
        // Convert the 24kHz Mono 16-bit PCM to a standard playable WAV
        const wavBuffer = pcmToWav(pcmBuffer, 24000);
        base64Wav = wavBuffer.toString("base64");
      }
    } catch (ttsErr: any) {
      console.error("Gemini TTS synthesis failed:", ttsErr);
      // We will handle this gracefully and let the frontend use standard text, and fallback to Web Speech API if necessary
    }

    res.json({
      text: pepTalkText,
      audio: base64Wav ? `data:audio/wav;base64,${base64Wav}` : null,
    });
  } catch (error: any) {
    console.error("Pep talk generation error:", error);
    res.status(500).json({ error: error.message || "Failed to generate pep talk. Please verify your GEMINI_API_KEY configuration." });
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
