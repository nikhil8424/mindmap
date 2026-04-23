import { Slider } from "./ui/slider";
import { Button } from "./ui/button";
import { Play, Pause, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  minTs: number;
  maxTs: number;
  range: [number, number];
  onChange: (range: [number, number]) => void;
}

function fmt(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function TimelineSlider({ minTs, maxTs, range, onChange }: Props) {
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const startRangeRef = useRef<[number, number]>([minTs, maxTs]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    startTimeRef.current = performance.now();
    startRangeRef.current = [...range] as [number, number];
    const total = maxTs - minTs;
    const playWindow = Math.max(1, range[1] - range[0]);
    const PLAY_DURATION_MS = 6000; // sweep takes 6 seconds

    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      const t = Math.min(1, elapsed / PLAY_DURATION_MS);
      // Sweep the right edge from current position to maxTs
      const newEnd = Math.min(maxTs, startRangeRef.current[1] + (maxTs - startRangeRef.current[1]) * t);
      const newStart = Math.max(minTs, newEnd - playWindow);
      onChange([newStart, newEnd]);
      if (t >= 1) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  if (maxTs <= minTs) return null;

  return (
    <div className="glass-panel rounded-xl px-4 py-3 flex items-center gap-3 shadow-2xl pointer-events-auto">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause timeline" : "Play timeline"}
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 text-white/70 hover:text-white hover:bg-white/10"
        onClick={() => {
          setPlaying(false);
          onChange([minTs, maxTs]);
        }}
        aria-label="Reset timeline"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </Button>
      <div className="text-[10px] font-mono text-white/60 w-20 shrink-0">{fmt(range[0])}</div>
      <div className="flex-1">
        <Slider
          value={range}
          min={minTs}
          max={maxTs}
          step={Math.max(60_000, Math.floor((maxTs - minTs) / 200))}
          onValueChange={(v) => onChange([v[0]!, v[1]!])}
        />
      </div>
      <div className="text-[10px] font-mono text-white/60 w-20 text-right shrink-0">{fmt(range[1])}</div>
    </div>
  );
}
