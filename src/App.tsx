import { useState, useEffect, useRef } from "react";
import { 
  Megaphone, 
  PartyPopper, 
  Clapperboard, 
  Medal, 
  Mic, 
  MicOff, 
  Play, 
  Pause, 
  Download, 
  Copy, 
  Check, 
  Volume2, 
  VolumeX,
  Volume,
  RefreshCw,
  Sparkle,
  User,
  ExternalLink,
  Flame,
  AlertCircle
} from "lucide-react";

interface PepTalkResponse {
  text: string;
  audio: string | null; // Base64 encoded WAV data URL
  artSvg?: string; // Custom Cassette Art SVG
}

export default function App() {
  // Input State
  const [intent, setIntent] = useState("");
  const [selectedPersona, setSelectedPersona] = useState<"coach" | "bestie" | "narrator" | "sergeant">("coach");
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Result State
  const [pepTalk, setPepTalk] = useState<PepTalkResponse | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Speech Recognition (Speech-to-Text) State
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);

  // Audio Ref
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Dynamic Equalizer State
  const [equalizerBars, setEqualizerBars] = useState<number[]>(Array(36).fill(10));

  // Audio generation fallback status (uses Web Speech API if server-side TTS fails)
  const [isUsingSpeechFallback, setIsUsingSpeechFallback] = useState(false);

  // Web Audio API Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationRef = useRef<number | null>(null);

  // Immersive loading messages
  const loadingPhrases = [
    "Stepping onto the court...",
    "Reviewing the playbook...",
    "Chalking up the hands...",
    "Taping the ankles...",
    "Rallying the front line...",
    "Polishing the championship trophy...",
    "Blowing the standard whistle...",
    "Unleashing the hype machine..."
  ];

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = "en-US";

        rec.onstart = () => {
          setIsRecording(true);
        };

        rec.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            setIntent((prev) => prev + (prev ? " " : "") + transcript);
          }
        };

        rec.onerror = (event: any) => {
          console.error("Speech recognition error:", event.error);
          setIsRecording(false);
        };

        rec.onend = () => {
          setIsRecording(false);
        };

        setRecognition(rec);
      }
    }
  }, []);

  // Real-time Web Audio API Equalizer animation loop
  const drawEqualizer = () => {
    if (!analyserRef.current) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    const newBars = [];
    // Map frequency bins to our 36 UI bars (skip the very lowest/highest frequencies for better visual)
    for (let i = 2; i < 38; i++) {
      // getByteFrequencyData returns 0-255. Map to 10-100%
      const value = Math.max(10, (dataArray[i] / 255) * 100);
      newBars.push(value);
    }
    setEqualizerBars(newBars);
    
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(drawEqualizer);
    }
  };

  useEffect(() => {
    if (isPlaying && audioRef.current && !isUsingSpeechFallback) {
      // Ensure AudioContext is initialized (must happen after user interaction)
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioContextRef.current = new AudioContextClass();
          analyserRef.current = audioContextRef.current.createAnalyser();
          analyserRef.current.fftSize = 128; // gives 64 frequency bins
          
          sourceRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
          sourceRef.current.connect(analyserRef.current);
          analyserRef.current.connect(audioContextRef.current.destination);
        }
      }

      if (audioContextRef.current?.state === "suspended") {
        audioContextRef.current.resume();
      }

      animationRef.current = requestAnimationFrame(drawEqualizer);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      // If using fallback or stopped, use a random jitter or reset
      if (isPlaying && isUsingSpeechFallback) {
        const intervalId = setInterval(() => {
          setEqualizerBars(Array.from({ length: 36 }, () => Math.floor(Math.random() * 85) + 15));
        }, 100);
        return () => clearInterval(intervalId);
      } else {
        setEqualizerBars(Array(36).fill(10));
      }
    }
    
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, isUsingSpeechFallback]);

  // Loading phrasing rotator
  useEffect(() => {
    let intervalId: any = null;
    if (isGenerating) {
      intervalId = setInterval(() => {
        setLoadingStep((prev) => (prev + 1) % loadingPhrases.length);
      }, 1500);
    } else {
      setLoadingStep(0);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isGenerating]);

  // Manage speech volume changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Audio fallback Web Speech API synthesis function
  const speakWithNativeFallback = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    // Stop existing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Map selected persona styles to native utterance properties
    switch (selectedPersona) {
      case "coach":
        utterance.pitch = 0.85;
        utterance.rate = 0.95;
        break;
      case "bestie":
        utterance.pitch = 1.15;
        utterance.rate = 1.1;
        break;
      case "narrator":
        utterance.pitch = 0.65;
        utterance.rate = 0.8;
        break;
      case "sergeant":
        utterance.pitch = 0.95;
        utterance.rate = 1.25;
        break;
    }

    utterance.onstart = () => {
      setIsPlaying(true);
    };

    utterance.onend = () => {
      setIsPlaying(false);
    };

    utterance.onerror = () => {
      setIsPlaying(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  // Toggle Voice Input Recording
  const handleToggleRecord = () => {
    if (!recognition) {
      alert("Speech recognition is not supported in your browser. Please type your intent manually.");
      return;
    }

    if (isRecording) {
      recognition.stop();
    } else {
      setError(null);
      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to start speech recognition:", e);
      }
    }
  };

  // Generate Pep Talk Function
  const handleGenerate = async () => {
    if (!intent.trim()) {
      setError("Please describe what you are about to walk into!");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setPepTalk(null);
    setIsPlaying(false);
    setIsUsingSpeechFallback(false);

    // Stop active audio/synthesis before generating a new one
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    try {
      const response = await fetch("/api/peptalk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: intent.trim(),
          persona: selectedPersona,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Generation failed on the server.");
      }

      const data: PepTalkResponse = await response.json();
      setPepTalk(data);

      if (!data.audio) {
        setIsUsingSpeechFallback(true);
      }

      // Smooth scroll to results
      setTimeout(() => {
        const resultSection = document.getElementById("result-section");
        if (resultSection) {
          resultSection.scrollIntoView({ behavior: "smooth" });
        }
      }, 100);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred. Please verify your internet and API secrets.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Playback State
  const handlePlayPause = () => {
    if (!pepTalk) return;

    if (isUsingSpeechFallback) {
      if (isPlaying) {
        window.speechSynthesis.pause();
        setIsPlaying(false);
      } else {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
          setIsPlaying(true);
        } else {
          speakWithNativeFallback(pepTalk.text);
        }
      }
    } else if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().catch((err) => {
          console.error("Audio playback error:", err);
          // If browser blocks autoplay or PCM fails, trigger native fallback
          setIsUsingSpeechFallback(true);
          speakWithNativeFallback(pepTalk.text);
        });
      }
    }
  };

  // Copy text to clipboard
  const handleCopy = () => {
    if (!pepTalk) return;
    navigator.clipboard.writeText(pepTalk.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download audio WAV file
  const handleDownload = () => {
    if (!pepTalk || !pepTalk.audio) return;
    
    const link = document.createElement("a");
    link.href = pepTalk.audio;
    link.download = `lockerroom_${selectedPersona}_hype.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Example scenario templates to populate the input (Hackathon World Cup & Rivalry focus)
  const presets = [
    { text: "Playing our bitter rivals in the Sunday league championship", label: "Sunday League Rivalry" },
    { text: "Watching my nation in the World Cup finals penalty shootout", label: "World Cup Penalties" },
    { text: "Shipping my passion side-project to Product Hunt at midnight", label: "Midnight Launch" },
    { text: "Stepping onto the platform for a 3-plate Squat personal record", label: "Squat PR" },
  ];

  // Helper to get accent hex code for active visual states
  const getPersonaColor = (persona: string) => {
    switch (persona) {
      case "coach": return "var(--color-brand-accent-amber)";
      case "bestie": return "var(--color-brand-accent-pink)";
      case "narrator": return "var(--color-brand-accent-red)";
      case "sergeant": return "var(--color-brand-accent-blue)";
      default: return "var(--color-brand-primary)";
    }
  };

  const getPersonaColorClass = (persona: string) => {
    switch (persona) {
      case "coach": return "text-[#fbbc00] border-[#fbbc00] bg-[#fbbc00]/10";
      case "bestie": return "text-[#ffb0d0] border-[#ffb0d0] bg-[#ffb0d0]/10";
      case "narrator": return "text-[#ff4e50] border-[#ff4e50] bg-[#ff4e50]/10"; // slightly brighter blood red for visibility
      case "sergeant": return "text-[#abc7ff] border-[#abc7ff] bg-[#abc7ff]/10";
      default: return "text-brand-primary border-brand-primary";
    }
  };

  const getPersonaGlowStyle = (persona: string) => {
    const color = getPersonaColor(persona);
    return {
      boxShadow: `0 0 25px ${color}33`,
      borderColor: color,
    };
  };

  return (
    <div className="min-h-screen bg-brand-bg text-on-background font-sans relative flex flex-col justify-between overflow-x-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,226,171,0.05),transparent_50%)] pointer-events-none -z-10" />

      {/* Top Navbar */}
      <header className="bg-brand-bg/95 border-b border-outline-variant flex justify-between items-center px-6 md:px-12 py-4 sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-2xl md:text-3xl text-brand-primary tracking-tighter uppercase">LOCKER ROOM</h1>
        </div>
        <div className="flex items-center gap-3">
          <button className="text-brand-primary border border-brand-primary rounded-full hover:bg-brand-primary/10 transition-colors p-1.5 flex items-center justify-center">
            <User className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-[1200px] mx-auto w-full px-4 md:px-12 py-8 flex-grow">
        
        {/* Hero Section */}
        <section className="text-center py-6 md:py-10 max-w-3xl mx-auto flex flex-col items-center">
          <h2 className="font-display text-4xl md:text-7xl uppercase tracking-tighter leading-tight drop-shadow-md text-white">
            STEP INTO THE LOCKER ROOM
          </h2>
          <p className="mt-4 text-[#888] font-sans text-base md:text-lg max-w-xl">
            Select your intent, choose your persona, and get the exact hype you need before you step onto the field.
          </p>
        </section>

        {/* Input Area + Persona Picker */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          
          {/* Left Column: Custom Textarea */}
          <div className="lg:col-span-5 flex flex-col">
            <label className="font-display text-xl md:text-2xl text-brand-primary uppercase tracking-tight mb-3 block">
              WHAT ARE YOU ABOUT TO WALK INTO?
            </label>
            <div className="relative flex-grow flex flex-col min-h-[320px]">
              <textarea
                className="w-full flex-grow bg-[#1a1a1a] border border-[#333] rounded-md focus:border-brand-primary text-white p-5 font-sans text-base leading-relaxed placeholder-[#666] resize-none outline-none transition-all"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="e.g. A rivalry match, Launching my side project, A final exam..."
              />
              
              {/* Record Button */}
              <button
                onClick={handleToggleRecord}
                className={`absolute bottom-4 right-4 p-3 rounded-full transition-all flex items-center justify-center cursor-pointer ${
                  isRecording 
                    ? "bg-red-950 text-red-400 animate-pulse" 
                    : "bg-[#222] hover:bg-[#333] text-[#888] hover:text-white"
                }`}
                title={isRecording ? "Stop voice input" : "Start voice input (Speech to Text)"}
              >
                {isRecording ? <MicOff className="h-5 w-5 animate-breathe" /> : <Mic className="h-5 w-5" />}
              </button>
            </div>
            
            {/* Presets */}
            <div className="mt-4 flex flex-wrap gap-2">
              {presets.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setIntent(p.text)}
                  className="bg-[#1a1a1a] hover:bg-[#333] border border-[#333] text-xs font-mono text-[#888] hover:text-white px-3 py-1.5 transition-colors cursor-pointer"
                >
                  + {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right Column: Persona Grid */}
          <div className="lg:col-span-7 flex flex-col">
            <h3 className="font-display text-xl md:text-2xl text-white uppercase tracking-tight mb-3">
              CHOOSE YOUR CORNERMAN
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-grow">
              
              {/* Persona 1: Coach */}
              <button
                onClick={() => setSelectedPersona("coach")}
                className={`text-left bg-[#1a1a1a] rounded-md p-5 flex flex-col justify-between transition-all cursor-pointer group outline-none border ${
                  selectedPersona === "coach" ? "border-brand-accent-amber bg-[#1a1a1a]" : "border-[#333] hover:border-brand-accent-amber/40"
                }`}
                style={selectedPersona === "coach" ? { boxShadow: `0 0 0 1px var(--color-brand-accent-amber)` } : {}}
              >
                <div className="flex justify-between items-center w-full mb-4">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-brand-accent-amber bg-brand-accent-amber/10 px-2 py-1 rounded-sm">
                    AMBER ACCENT
                  </span>
                  <Megaphone className="h-5 w-5 text-brand-accent-amber opacity-60 group-hover:opacity-100 transition-opacity" />
                </div>
                <div>
                  <h4 className="font-display text-xl text-white uppercase leading-none mb-1">
                    The Hard-Nosed Coach
                  </h4>
                  <p className="text-[#888] text-sm font-sans leading-relaxed">
                    Gruff, tough love, old-school.
                  </p>
                </div>
              </button>

              {/* Persona 2: Bestie */}
              <button
                onClick={() => setSelectedPersona("bestie")}
                className={`text-left bg-[#1a1a1a] rounded-md p-5 flex flex-col justify-between transition-all cursor-pointer group outline-none border ${
                  selectedPersona === "bestie" ? "border-brand-accent-pink bg-[#1a1a1a]" : "border-[#333] hover:border-brand-accent-pink/40"
                }`}
                style={selectedPersona === "bestie" ? { boxShadow: `0 0 0 1px var(--color-brand-accent-pink)` } : {}}
              >
                <div className="flex justify-between items-center w-full mb-4">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-brand-accent-pink bg-brand-accent-pink/10 px-2 py-1 rounded-sm">
                    HOT PINK ACCENT
                  </span>
                  <PartyPopper className="h-5 w-5 text-brand-accent-pink opacity-60 group-hover:opacity-100 transition-opacity" />
                </div>
                <div>
                  <h4 className="font-display text-xl text-white uppercase leading-none mb-1">
                    The Ride-or-Die Bestie
                  </h4>
                  <p className="text-[#888] text-sm font-sans leading-relaxed">
                    Hype, personal, loud.
                  </p>
                </div>
              </button>

              {/* Persona 3: Narrator */}
              <button
                onClick={() => setSelectedPersona("narrator")}
                className={`text-left bg-[#1a1a1a] rounded-md p-5 flex flex-col justify-between transition-all cursor-pointer group outline-none border ${
                  selectedPersona === "narrator" ? "border-brand-accent-red bg-[#1a1a1a]" : "border-[#333] hover:border-brand-accent-red/40"
                }`}
                style={selectedPersona === "narrator" ? { boxShadow: `0 0 0 1px var(--color-brand-accent-red)` } : {}}
              >
                <div className="flex justify-between items-center w-full mb-4">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-brand-accent-red bg-brand-accent-red/10 px-2 py-1 rounded-sm">
                    BLOOD RED ACCENT
                  </span>
                  <Clapperboard className="h-5 w-5 text-brand-accent-red opacity-60 group-hover:opacity-100 transition-opacity" />
                </div>
                <div>
                  <h4 className="font-display text-xl text-white uppercase leading-none mb-1">
                    The Movie-Trailer Narrator
                  </h4>
                  <p className="text-[#888] text-sm font-sans leading-relaxed">
                    Deep, cinematic, epic stakes.
                  </p>
                </div>
              </button>

              {/* Persona 4: Sergeant */}
              <button
                onClick={() => setSelectedPersona("sergeant")}
                className={`text-left bg-[#1a1a1a] rounded-md p-5 flex flex-col justify-between transition-all cursor-pointer group outline-none border ${
                  selectedPersona === "sergeant" ? "border-brand-accent-blue bg-[#1a1a1a]" : "border-[#333] hover:border-brand-accent-blue/40"
                }`}
                style={selectedPersona === "sergeant" ? { boxShadow: `0 0 0 1px var(--color-brand-accent-blue)` } : {}}
              >
                <div className="flex justify-between items-center w-full mb-4">
                  <span className="font-mono text-[10px] font-bold tracking-wider text-brand-accent-blue bg-brand-accent-blue/10 px-2 py-1 rounded-sm">
                    ELECTRIC BLUE ACCENT
                  </span>
                  <Medal className="h-5 w-5 text-brand-accent-blue opacity-60 group-hover:opacity-100 transition-opacity" />
                </div>
                <div>
                  <h4 className="font-display text-xl text-white uppercase leading-none mb-1">
                    The Drill Sergeant
                  </h4>
                  <p className="text-[#888] text-sm font-sans leading-relaxed">
                    Military intensity, relentless.
                  </p>
                </div>
              </button>

            </div>
          </div>
        </section>

        {/* Action Button & Error Info */}
        <section className="mt-12 text-center flex flex-col items-center">
          {error && (
            <div className="mb-6 flex items-center gap-2 text-rose-400 bg-rose-950/40 border-2 border-rose-900 px-6 py-3 max-w-xl text-sm font-sans">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full md:w-auto min-w-[400px] px-16 py-6 bg-[#ffe4a0] text-[#1a1a1a] font-display text-5xl uppercase tracking-wide border-4 border-[#1a1a1a] hover:bg-[#ffd570] transition-colors shadow-[10px_10px_0px_0px_#524a3a] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? loadingPhrases[loadingStep] : "GENERATE PEP TALK"}
          </button>
        </section>

        {/* Hidden internal audio element */}
        {pepTalk?.audio && (
          <audio
            ref={audioRef}
            src={pepTalk.audio}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          />
        )}

        {/* Tape Output / Result Section */}
        {pepTalk && (
          <section
            id="result-section"
            className="mt-20 pt-12 border-t-2 border-dashed border-[#333] animate-fade-in-up"
          >
            <div className="bg-[#0e0e0e] border-2 border-[#333] p-6 md:p-10 relative overflow-hidden">
              
              {/* Top Row: Info & Tool buttons */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                  <span className="font-mono text-[10px] text-[#888] tracking-widest uppercase block mb-1">
                    AUDIO CASSETTE // RECORD_SYS_01
                  </span>
                  <h3 className="font-display text-2xl md:text-3xl text-brand-primary uppercase">
                    YOUR TAPE IS READY
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="bg-[#1c1b1b] border border-[#333] hover:border-brand-primary text-white px-4 py-2 text-xs font-mono uppercase flex items-center gap-2 transition-all"
                    style={{ borderRadius: 0 }}
                  >
                    {copied ? <Check className="h-4.5 w-4.5 text-emerald-400" /> : <Copy className="h-4.5 w-4.5" />}
                    {copied ? "COPIED" : "COPY TRANSCRIPT"}
                  </button>
                  
                  {pepTalk.audio && (
                    <button
                      onClick={handleDownload}
                      className="bg-[#1c1b1b] border border-[#333] hover:border-[#fbbc00] text-white px-4 py-2 text-xs font-mono uppercase flex items-center gap-2 transition-all"
                      style={{ borderRadius: 0 }}
                    >
                      <Download className="h-4.5 w-4.5" />
                      DOWNLOAD AUDIO
                    </button>
                  )}
                </div>
              </div>

              {/* Grid block: Cassette Deck Controller & Equalizer */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center bg-[#141414] border border-[#222] p-6 mb-8">
                
                {/* Visual cassette styling or big Play/Pause wheel */}
                <div className="md:col-span-4 flex flex-col items-center justify-center border-r border-[#222] pr-0 md:pr-8 py-4">
                  <div className="relative">
                    {/* The Tape Wheel */}
                    <div className="w-24 h-24 rounded-full border-4 border-[#333] flex items-center justify-center bg-[#1a1a1a] relative shadow-inner">
                      {/* Interactive dynamic center glow */}
                      <div 
                        className="absolute inset-2 rounded-full border-2 border-dashed border-[#444] animate-spin" 
                        style={{ animationDuration: isPlaying ? "5s" : "0s" }} 
                      />
                      <button
                        onClick={handlePlayPause}
                        className={`relative z-10 h-16 w-16 rounded-full flex items-center justify-center transition-all shadow-md cursor-pointer ${
                          isPlaying 
                            ? "bg-red-700 hover:bg-red-600 text-white" 
                            : "bg-[#ffe2ab] hover:bg-[#ffeecb] text-brand-bg"
                        }`}
                      >
                        {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8 fill-current ml-1" />}
                      </button>
                    </div>
                  </div>
                  <span className="font-mono text-[11px] tracking-wider text-[#666] uppercase mt-3">
                    {isPlaying ? "PLAYING_HYPE_STREAM" : "TAPE_STANDBY"}
                  </span>
                </div>

                {/* Animated Equalizer Waveform */}
                <div className="md:col-span-8 flex flex-col justify-center py-4 w-full">
                  <div className="flex items-end justify-between gap-[2px] h-20 w-full mb-3 bg-[#0a0a0a] px-4 border border-[#222]">
                    {equalizerBars.map((height, i) => (
                      <div
                        key={i}
                        className="w-full transition-all duration-100"
                        style={{
                          height: `${height}%`,
                          backgroundColor: getPersonaColor(selectedPersona),
                          boxShadow: isPlaying ? `0 0 10px ${getPersonaColor(selectedPersona)}aa` : "none"
                        }}
                      />
                    ))}
                  </div>
                  
                  {/* Seek tracker if physical audio available */}
                  {pepTalk.audio && (
                    <div className="flex items-center justify-between font-mono text-[10px] text-[#666]">
                      <span>
                        {Math.floor(currentTime / 60)}:
                        {Math.floor(currentTime % 60).toString().padStart(2, "0")}
                      </span>
                      <div className="flex-grow mx-4 h-1 bg-[#222] relative">
                        <div 
                          className="absolute left-0 top-0 h-full"
                          style={{ 
                            width: `${duration ? (currentTime / duration) * 100 : 0}%`,
                            backgroundColor: getPersonaColor(selectedPersona)
                          }}
                        />
                      </div>
                      <span>
                        {Math.floor(duration / 60)}:
                        {Math.floor(duration % 60).toString().padStart(2, "0")}
                      </span>
                    </div>
                  )}

                  {/* Fallback voice synthesis notice */}
                  {isUsingSpeechFallback && (
                    <div className="mt-2 text-center bg-[#ffe2ab]/5 border border-[#ffe2ab]/20 px-3 py-1">
                      <span className="font-mono text-[9px] text-[#ffe2ab] tracking-wider uppercase">
                        ⚡ LOCAL VOICE SYNTHESIS ENGINE LOADED FOR IMPECCABLE LATENCY
                      </span>
                    </div>
                  )}
                </div>

              </div>

              {/* The Written Speech - Tactical Chalkboard Card style */}
              <div 
                className="bg-[#1c1b1b] border-2 border-[#333] p-6 md:p-8 relative"
                style={{ borderRadius: 0 }}
              >
                {/* Cassette Art SVG (Generated by Gemini) */}
                {pepTalk.artSvg && (
                  <div className="mb-6 flex justify-center">
                    <div 
                      className="border-2 border-[#333] bg-[#1a1a1a] shadow-[8px_8px_0px_0px_#111] overflow-hidden"
                      dangerouslySetInnerHTML={{ __html: pepTalk.artSvg }}
                      style={{ width: "100%", maxWidth: "400px" }}
                    />
                  </div>
                )}
                {/* Blackboard header tag */}
                <div className="absolute top-0 left-0 bg-[#222] border-r-2 border-b-2 border-[#333] px-3 py-1 font-mono text-[10px] text-brand-primary uppercase">
                  PLAYBOOK SPEECH TAPE
                </div>

                <p 
                  className={`font-display text-lg md:text-2xl leading-relaxed text-left text-[#ffe2ab] mt-4`}
                  style={{
                    color: getPersonaColor(selectedPersona)
                  }}
                >
                  "{pepTalk.text}"
                </p>

                {/* Interactive speech retry button */}
                <div className="mt-8 flex justify-end border-t border-[#333] pt-4">
                  <button
                    onClick={handleGenerate}
                    className="text-xs font-mono text-on-surface-variant hover:text-white flex items-center gap-1.5 transition-all"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    RE-RECORD TAPE WITH FRESH INTENSITY
                  </button>
                </div>
              </div>

            </div>
          </section>
        )}

      </main>

      {/* Footer */}
      <footer className="bg-[#0e0e0e] border-t border-outline-variant py-8 px-6 md:px-12 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="font-mono text-[10px] tracking-widest text-[#666] uppercase flex items-center gap-2">
          <span>POWERED BY GEMINI + ELEVENLABS</span>
          <span className="text-[#333] font-sans">|</span>
          <span className="text-[#fbbc00]">TTS SYNTHESIS v2.5</span>
        </div>
        <div className="flex gap-6">
          <a className="font-mono text-[10px] tracking-wider text-[#666] hover:text-white transition-all uppercase" href="#terms">TERMS</a>
          <a className="font-mono text-[10px] tracking-wider text-[#666] hover:text-white transition-all uppercase" href="#privacy">PRIVACY</a>
        </div>
      </footer>
    </div>
  );
}
