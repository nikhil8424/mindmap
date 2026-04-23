import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useState, useRef, useMemo, useEffect } from "react";
import { useBuildGraph } from "@workspace/api-client-react";
import { GraphCanvas } from "./components/GraphCanvas";
import { useHandGesture } from "./hooks/useHandGesture";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch as ToggleSwitch } from "./components/ui/switch";
import { Label } from "./components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import type { GraphNode } from "@workspace/api-zod";
import { Loader2, Download, Sparkles, NotebookPen, Settings as SettingsIcon } from "lucide-react";
import { EntryComposer } from "./components/EntryComposer";
import { InsightsPanel } from "./components/InsightsPanel";
import { TimelineSlider } from "./components/TimelineSlider";
import { buildSeedEntries, type UIEntry } from "./lib/seed";

const queryClient = new QueryClient();

function Home() {
  const [entries, setEntries] = useState<UIEntry[]>(() => buildSeedEntries());
  const [topologyType, setTopologyType] = useState<"centralized" | "decentralized" | "distributed">("decentralized");
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [colorMode, setColorMode] = useState<"mood" | "cluster">("mood");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { gestureMode, frameRef } = useHandGesture(gestureEnabled, videoRef);

  const buildGraph = useBuildGraph();

  const handleGenerate = () => {
    if (entries.length < 2) return;
    buildGraph.mutate({
      data: {
        entries: entries.map((e) => ({
          text: e.text,
          date: e.date,
          timestamp: e.timestamp,
          mood: e.mood,
          energy: e.energy,
          stress: e.stress,
        })),
        threshold: 0.35,
        clusters: 4,
      },
    });
  };

  const activeTopology = buildGraph.data?.[topologyType] ?? null;
  const insights = buildGraph.data?.insights ?? null;

  // Initialize timeline range to span all generated nodes whenever a new graph arrives
  useEffect(() => {
    if (insights?.timeRange) {
      setTimeRange([insights.timeRange.startTimestamp, insights.timeRange.endTimestamp]);
    }
  }, [insights?.timeRange.startTimestamp, insights?.timeRange.endTimestamp]);

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const addEntry = (e: UIEntry) => setEntries((prev) => [...prev, e]);
  const deleteEntry = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));

  const tlMin = insights?.timeRange.startTimestamp ?? 0;
  const tlMax = insights?.timeRange.endTimestamp ?? 0;
  const tlRange = useMemo<[number, number] | null>(
    () => (timeRange ? timeRange : tlMax > tlMin ? [tlMin, tlMax] : null),
    [timeRange, tlMin, tlMax],
  );

  return (
    <div className="relative min-h-screen w-full bg-background overflow-hidden font-sans text-foreground">
      <GraphCanvas
        topology={activeTopology}
        gestureFrameRef={frameRef}
        gestureEnabled={gestureEnabled}
        onNodeClick={setSelectedNode}
        timeRange={tlRange}
        colorMode={colorMode}
      />

      {/* HUD */}
      <div className="absolute top-0 left-0 h-full w-full pointer-events-none p-6 flex flex-col justify-between">
        <header className="pointer-events-auto">
          <h1 className="text-3xl font-serif tracking-tight text-white/90 drop-shadow-md">Ideascape</h1>
          <p className="text-sm text-white/60 font-mono mt-1">A behavioural insight tool</p>
        </header>

        {/* Right column: webcam + tabbed panel */}
        <div className="self-end flex flex-col items-end gap-3 pointer-events-auto -mt-12">
          {gestureEnabled && (
            <div className="w-80 aspect-video bg-black rounded-xl overflow-hidden border border-white/10 shadow-2xl relative">
              <video
                ref={videoRef}
                className="w-full h-full object-cover scale-x-[-1]"
                autoPlay
                playsInline
                muted
              />
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-black/60 text-white/80 backdrop-blur">
                {gestureMode === "pinch" ? (
                  <span className="text-pink-300">PINCH</span>
                ) : gestureMode === "palm" ? (
                  <span className="text-amber-300">PALM</span>
                ) : gestureMode === "point" ? (
                  <span className="text-cyan-300">POINT</span>
                ) : (
                  <span className="text-white/50">IDLE</span>
                )}
              </div>
            </div>
          )}

          <div className="w-96 glass-panel rounded-xl p-4 flex flex-col gap-3 shrink-0 shadow-2xl max-h-[calc(100vh-12rem)]">
            <Tabs defaultValue="entries" className="w-full">
              <TabsList className="grid grid-cols-3 bg-black/40 border border-white/10 h-8">
                <TabsTrigger value="entries" className="text-[11px] data-[state=active]:bg-white/10">
                  <NotebookPen className="w-3 h-3 mr-1" /> Entries
                </TabsTrigger>
                <TabsTrigger value="insights" className="text-[11px] data-[state=active]:bg-white/10">
                  <Sparkles className="w-3 h-3 mr-1" /> Insights
                </TabsTrigger>
                <TabsTrigger value="settings" className="text-[11px] data-[state=active]:bg-white/10">
                  <SettingsIcon className="w-3 h-3 mr-1" /> Graph
                </TabsTrigger>
              </TabsList>

              <TabsContent value="entries" className="mt-3">
                <EntryComposer entries={entries} onAdd={addEntry} onDelete={deleteEntry} />
              </TabsContent>

              <TabsContent value="insights" className="mt-3 max-h-[55vh] overflow-y-auto pr-1">
                <InsightsPanel insights={insights} />
              </TabsContent>

              <TabsContent value="settings" className="mt-3 flex flex-col gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-white/60 uppercase tracking-wider font-mono">Topology</Label>
                  <Select value={topologyType} onValueChange={(v: any) => setTopologyType(v)}>
                    <SelectTrigger className="bg-black/40 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card/95 backdrop-blur border-white/10">
                      <SelectItem value="centralized">Centralized</SelectItem>
                      <SelectItem value="decentralized">Decentralized</SelectItem>
                      <SelectItem value="distributed">Distributed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] text-white/60 uppercase tracking-wider font-mono">Node colour</Label>
                  <Select value={colorMode} onValueChange={(v: any) => setColorMode(v)}>
                    <SelectTrigger className="bg-black/40 border-white/10 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card/95 backdrop-blur border-white/10">
                      <SelectItem value="mood">By mood (red → green)</SelectItem>
                      <SelectItem value="cluster">By cluster</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {activeTopology && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadCSV(activeTopology.nodesCsv, `${topologyType}_nodes.csv`)}
                      className="w-full bg-transparent border-white/10 text-white/80 hover:bg-white/5"
                    >
                      <Download className="mr-2 h-3 w-3" /> Nodes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadCSV(activeTopology.edgesCsv, `${topologyType}_edges.csv`)}
                      className="w-full bg-transparent border-white/10 text-white/80 hover:bg-white/5"
                    >
                      <Download className="mr-2 h-3 w-3" /> Edges
                    </Button>
                  </div>
                )}

                <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs text-white/70">Gesture controls</Label>
                    <div className="text-[10px] text-white/40 flex items-center gap-2">
                      {gestureEnabled && (
                        <span className="flex items-center gap-1">
                          <span
                            className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                              gestureMode === "pinch"
                                ? "bg-pink-400"
                                : gestureMode === "palm"
                                ? "bg-amber-300"
                                : gestureMode === "point"
                                ? "bg-cyan-300"
                                : "bg-white/40"
                            }`}
                          />
                          {gestureMode === "pinch"
                            ? "pinch — scale"
                            : gestureMode === "palm"
                            ? "palm — rotate"
                            : gestureMode === "point"
                            ? "point — drag"
                            : "show your hand"}
                        </span>
                      )}
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={gestureEnabled}
                    onCheckedChange={setGestureEnabled}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </TabsContent>
            </Tabs>

            <Button
              onClick={handleGenerate}
              disabled={buildGraph.isPending || entries.length < 2}
              className="w-full bg-primary/20 hover:bg-primary/40 text-primary border border-primary/30 transition-all"
            >
              {buildGraph.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Synthesizing...
                </>
              ) : (
                "Generate Constellation"
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Bottom timeline */}
      {tlRange && tlMax > tlMin && (
        <div className="absolute bottom-6 left-6 right-[26rem] z-40">
          <TimelineSlider
            minTs={tlMin}
            maxTs={tlMax}
            range={tlRange}
            onChange={setTimeRange}
          />
        </div>
      )}

      {/* Node tooltip */}
      {selectedNode && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass-panel p-4 rounded-lg text-white max-w-sm pointer-events-auto shadow-2xl animate-in fade-in zoom-in duration-300">
          <div className="text-[10px] font-mono uppercase tracking-wider text-white/50 mb-1 flex items-center gap-2">
            <span>{selectedNode.date}</span>
            <span>mood {selectedNode.mood}</span>
            <span>energy {selectedNode.energy}</span>
            <span>stress {selectedNode.stress}</span>
          </div>
          <p className="text-sm leading-relaxed font-serif">{selectedNode.text}</p>
          <div className="text-[10px] font-mono text-white/40 mt-2">
            sentiment {selectedNode.sentiment.toFixed(2)} · seen {selectedNode.frequency}×
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 text-white/50 hover:text-white hover:bg-white/5 h-6 px-2 text-xs"
            onClick={() => setSelectedNode(null)}
          >
            Close
          </Button>
        </div>
      )}
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
