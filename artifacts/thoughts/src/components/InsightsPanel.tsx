import type { Insights } from "@workspace/api-zod";
import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";

interface Props {
  insights: Insights | null;
}

function moodColor(mood: number): string {
  const hue = Math.round(((Math.max(1, Math.min(10, mood)) - 1) / 9) * 130);
  return `hsl(${hue}, 75%, 60%)`;
}

export function InsightsPanel({ insights }: Props) {
  if (!insights) {
    return (
      <div className="text-xs text-white/50 text-center py-6">
        Generate a constellation to see behavioural insights.
      </div>
    );
  }

  const trend = insights.emotionalTrend;
  const TrendIcon =
    trend.direction === "improving" ? TrendingUp : trend.direction === "declining" ? TrendingDown : Minus;
  const trendColor =
    trend.direction === "improving" ? "text-emerald-300" : trend.direction === "declining" ? "text-rose-300" : "text-white/60";

  return (
    <div className="flex flex-col gap-3 text-white/85">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-black/40 border border-white/10 p-2.5">
          <div className="text-[9px] uppercase tracking-wider font-mono text-white/50">Recent mood</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl font-serif" style={{ color: moodColor(trend.recentAvgMood) }}>
              {trend.recentAvgMood.toFixed(1)}
            </span>
            <span className="text-[10px] text-white/40">/ 10</span>
          </div>
          <div className={`mt-1 flex items-center gap-1 text-[10px] font-mono ${trendColor}`}>
            <TrendIcon className="w-3 h-3" />
            {trend.direction} ({trend.slope >= 0 ? "+" : ""}{trend.slope.toFixed(2)}/day)
          </div>
        </div>
        <div className="rounded-lg bg-black/40 border border-white/10 p-2.5">
          <div className="text-[9px] uppercase tracking-wider font-mono text-white/50 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Predicted next
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span
              className="text-xl font-serif"
              style={{ color: moodColor(insights.predictedNextMood) }}
            >
              {insights.predictedNextMood.toFixed(1)}
            </span>
            <span className="text-[10px] text-white/40">/ 10</span>
          </div>
          <div className="mt-1 text-[10px] text-white/40 font-mono">based on recent pattern</div>
        </div>
      </div>

      {/* Dominant themes */}
      <Section title="Dominant themes">
        {insights.dominantThemes.length === 0 ? (
          <Empty text="No recurring themes yet." />
        ) : (
          <div className="flex flex-wrap gap-1">
            {insights.dominantThemes.map((t) => (
              <span
                key={t.keyword}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-primary/10 border border-primary/20 text-primary/90"
              >
                {t.keyword}
                <span className="ml-1 text-white/50">{t.count}</span>
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Triggers */}
      <Section title="Potential triggers">
        {insights.triggers.length === 0 ? (
          <Empty text="Need more entries to detect triggers." />
        ) : (
          <div className="space-y-1">
            {insights.triggers.slice(0, 5).map((t) => {
              const positive = t.delta >= 0;
              return (
                <div key={t.keyword} className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-white/85">{t.keyword}</span>
                  <span className={positive ? "text-emerald-300" : "text-rose-300"}>
                    {positive ? "+" : ""}{t.delta.toFixed(2)}
                    <span className="text-white/40 ml-1">({t.occurrences}×)</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Repeated thoughts */}
      <Section title="Most repeated thoughts">
        {insights.repeatedThoughts.length === 0 ? (
          <Empty text="No semantic repeats detected." />
        ) : (
          <div className="space-y-1.5">
            {insights.repeatedThoughts.map((r, i) => (
              <div key={i} className="text-[11px] text-white/80 leading-snug">
                <span className="text-white/40 font-mono mr-1">{r.count}×</span>
                <span className="italic">"{truncate(r.text, 70)}"</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Mood timeline sparkline */}
      <Section title="Mood timeline">
        <Sparkline series={insights.moodSeries} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/10 pt-2">
      <div className="text-[9px] uppercase tracking-wider font-mono text-white/50 mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-[11px] text-white/40 italic">{text}</div>;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

function Sparkline({ series }: { series: { avgMood: number; date: string }[] }) {
  if (series.length < 2) {
    return <div className="text-[11px] text-white/40 italic">Not enough data points yet.</div>;
  }
  const w = 240;
  const h = 50;
  const pad = 4;
  const xs = series.map((_, i) => pad + (i / (series.length - 1)) * (w - pad * 2));
  const ys = series.map((p) => {
    const t = (p.avgMood - 1) / 9;
    return h - pad - t * (h - pad * 2);
  });
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i]!.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12">
      <path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" className="text-cyan-300/80" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={1.6} fill={moodColor(series[i]!.avgMood)} />
      ))}
    </svg>
  );
}
