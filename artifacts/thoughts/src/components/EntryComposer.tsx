import { useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Slider } from "./ui/slider";
import { Label } from "./ui/label";
import { Plus, X } from "lucide-react";
import { type UIEntry, todayISO, isoToTimestamp } from "../lib/seed";

interface Props {
  entries: UIEntry[];
  onAdd: (entry: UIEntry) => void;
  onDelete: (id: string) => void;
}

function moodColor(mood: number): string {
  // Red (mood 1) → Yellow (5) → Green (10)
  const hue = Math.round(((mood - 1) / 9) * 130);
  return `hsl(${hue}, 75%, 55%)`;
}

export function EntryComposer({ entries, onAdd, onDelete }: Props) {
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayISO());
  const [mood, setMood] = useState(5);
  const [energy, setEnergy] = useState(5);
  const [stress, setStress] = useState(5);

  const submit = () => {
    if (text.trim().length === 0) return;
    onAdd({
      id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: text.trim(),
      date,
      timestamp: isoToTimestamp(date) + Date.now() % 60_000,
      mood,
      energy,
      stress,
    });
    setText("");
  };

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's on your mind today?"
        className="min-h-[88px] resize-none bg-black/40 border-white/10 text-white placeholder:text-white/30 text-sm focus-visible:ring-primary focus-visible:ring-offset-0"
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-[10px] text-white/60 uppercase tracking-wider font-mono">Date</Label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full bg-black/40 border border-white/10 text-white text-sm rounded-md px-2 py-1 focus:outline-none focus:border-primary/50"
          />
        </div>

        <SliderField label="Mood" value={mood} onChange={setMood} accent={moodColor(mood)} />
        <SliderField label="Energy" value={energy} onChange={setEnergy} accent="hsl(195,80%,55%)" />
        <div className="col-span-2">
          <SliderField label="Stress" value={stress} onChange={setStress} accent="hsl(330,75%,60%)" />
        </div>
      </div>

      <Button
        onClick={submit}
        disabled={text.trim().length === 0}
        className="w-full bg-primary/20 hover:bg-primary/40 text-primary border border-primary/30 transition-all"
      >
        <Plus className="mr-1 h-4 w-4" />
        Add entry
      </Button>

      <div className="border-t border-white/10 pt-2">
        <Label className="text-[10px] text-white/60 uppercase tracking-wider font-mono">
          {entries.length} entries
        </Label>
        <div className="mt-1 max-h-44 overflow-y-auto pr-1 space-y-1.5">
          {[...entries].sort((a, b) => b.timestamp - a.timestamp).map((e) => (
            <div
              key={e.id}
              className="group flex items-start gap-2 px-2 py-1.5 rounded bg-black/30 border border-white/5 hover:border-white/15 transition-colors"
            >
              <div
                className="w-2 h-2 mt-1.5 rounded-full shrink-0"
                style={{ backgroundColor: moodColor(e.mood) }}
                title={`Mood ${e.mood}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[9px] text-white/40 font-mono uppercase tracking-wider">
                  <span>{e.date}</span>
                  <span>m{e.mood} · e{e.energy} · s{e.stress}</span>
                </div>
                <p className="text-xs text-white/85 leading-snug mt-0.5 line-clamp-2">{e.text}</p>
              </div>
              <button
                onClick={() => onDelete(e.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-white/40 hover:text-white"
                aria-label="Delete entry"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
  accent,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  accent: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label className="text-[10px] text-white/60 uppercase tracking-wider font-mono">{label}</Label>
        <span className="text-[11px] font-mono" style={{ color: accent }}>{value}</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? value)}
        min={1}
        max={10}
        step={1}
        className="w-full"
      />
    </div>
  );
}
