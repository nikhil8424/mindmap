import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useState, useRef, useEffect } from "react";
import { useBuildGraph } from "@workspace/api-client-react";
import { GraphCanvas } from "./components/GraphCanvas";
import { useHandGesture } from "./hooks/useHandGesture";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch as ToggleSwitch } from "./components/ui/switch";
import { Label } from "./components/ui/label";
import { GraphNode } from "@workspace/api-zod/src/generated/types";
import { Loader2, Download } from "lucide-react";

const queryClient = new QueryClient();

const SEED_TEXT = `A memory of floating over a vast, dark ocean.
The way light fractures through a prism.
I keep returning to the idea of decentralization as a natural state.
A feeling of absolute stillness in a crowded room.
Ideas are not singular, they are constellations.
How does one capture the ephemeral nature of a dream?
The architecture of a thought is not linear.
Neural pathways firing like city lights seen from space.
Seeking patterns in chaos.
Silence is the canvas for sound.`;

function Home() {
  const [notesText, setNotesText] = useState(SEED_TEXT);
  const [topologyType, setTopologyType] = useState<"centralized" | "decentralized" | "distributed">("decentralized");
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { gestureState, frameRef } = useHandGesture(gestureEnabled, videoRef);

  const buildGraph = useBuildGraph();

  const handleGenerate = () => {
    const notes = notesText.split('\n').filter(n => n.trim().length > 0);
    if (notes.length < 2) return;
    buildGraph.mutate({
      data: {
        notes,
        threshold: 0.35,
        clusters: 4
      }
    });
  };

  const activeTopology = buildGraph.data?.[topologyType] ?? null;

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="relative min-h-screen w-full bg-background overflow-hidden font-sans text-foreground">
      {/* 3D Canvas Background */}
      <GraphCanvas
        topology={activeTopology}
        gestureFrameRef={frameRef}
        gestureEnabled={gestureEnabled}
        onNodeClick={setSelectedNode}
      />

      {/* Floating UI HUD */}
      <div className="absolute top-0 left-0 h-full w-full pointer-events-none p-6 flex flex-col justify-between">
        <header className="pointer-events-auto">
          <h1 className="text-3xl font-serif tracking-tight text-white/90 drop-shadow-md">
            Topologies of Thoughts
          </h1>
          <p className="text-sm text-white/60 font-mono mt-1">A meditative thinking tool</p>
        </header>

        <div className="w-80 glass-panel rounded-xl p-5 pointer-events-auto flex flex-col gap-4 self-end shrink-0 shadow-2xl">
          <div className="space-y-2">
            <Label className="text-xs text-white/70 uppercase tracking-wider font-mono">Stream of consciousness</Label>
            <Textarea 
              value={notesText}
              onChange={e => setNotesText(e.target.value)}
              className="min-h-[200px] resize-none bg-black/40 border-white/10 text-white placeholder:text-white/30 text-sm focus-visible:ring-primary focus-visible:ring-offset-0 focus-visible:border-primary/50"
              placeholder="Enter thoughts here..."
            />
          </div>

          <Button 
            onClick={handleGenerate} 
            disabled={buildGraph.isPending}
            className="w-full bg-primary/20 hover:bg-primary/40 text-primary border border-primary/30 transition-all duration-300"
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

          {activeTopology && (
            <>
              <div className="pt-2 border-t border-white/10 space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-white/70 uppercase tracking-wider font-mono">Topology</Label>
                  <Select value={topologyType} onValueChange={(v: any) => setTopologyType(v)}>
                    <SelectTrigger className="bg-black/40 border-white/10 text-white">
                      <SelectValue placeholder="Select topology" />
                    </SelectTrigger>
                    <SelectContent className="bg-card/95 backdrop-blur border-white/10">
                      <SelectItem value="centralized">Centralized</SelectItem>
                      <SelectItem value="decentralized">Decentralized</SelectItem>
                      <SelectItem value="distributed">Distributed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => downloadCSV(activeTopology.nodesCsv, `${topologyType}_nodes.csv`)}
                    className="w-full bg-transparent border-white/10 text-white/80 hover:bg-white/5 hover:text-white"
                  >
                    <Download className="mr-2 h-3 w-3" />
                    Nodes
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => downloadCSV(activeTopology.edgesCsv, `${topologyType}_edges.csv`)}
                    className="w-full bg-transparent border-white/10 text-white/80 hover:bg-white/5 hover:text-white"
                  >
                    <Download className="mr-2 h-3 w-3" />
                    Edges
                  </Button>
                </div>
              </div>
            </>
          )}

          <div className="pt-2 border-t border-white/10 flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-xs text-white/70">Gesture Controls</Label>
              <div className="text-[10px] text-white/40 flex items-center gap-2">
                {gestureEnabled && (
                  <span className="flex items-center gap-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                        gestureState === 'grab'
                          ? 'bg-pink-400'
                          : gestureState === 'tracking'
                          ? 'bg-cyan-300'
                          : 'bg-white/40'
                      }`}
                    />
                    {gestureState === 'grab'
                      ? 'grab'
                      : gestureState === 'tracking'
                      ? 'tracking'
                      : 'looking for hand'}
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
        </div>

      </div>

      {/* Webcam Preview */}
      {gestureEnabled && (
        <div className="absolute bottom-6 left-6 w-40 aspect-video bg-black rounded-lg overflow-hidden border border-white/10 shadow-lg z-50">
          <video
            ref={videoRef}
            className="w-full h-full object-cover scale-x-[-1]"
            autoPlay
            playsInline
            muted
          />
          <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider bg-black/60 text-white/80 backdrop-blur">
            {gestureState === 'grab' ? (
              <span className="text-pink-300">GRAB</span>
            ) : gestureState === 'tracking' ? (
              <span className="text-cyan-300">TRACK</span>
            ) : (
              <span className="text-white/50">SEARCHING</span>
            )}
          </div>
        </div>
      )}

      {/* Node Tooltip */}
      {selectedNode && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 glass-panel p-4 rounded-lg text-white max-w-sm pointer-events-auto shadow-2xl animate-in fade-in zoom-in duration-300">
          <p className="text-sm leading-relaxed font-serif">{selectedNode.text}</p>
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
