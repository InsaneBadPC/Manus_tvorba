import { useEffect, useMemo, useState } from "react";
import {
  Activity, Bot, Check, ChevronDown, ChevronRight, Code2, Command, Cpu,
  Folder, GitBranch, History, LayoutDashboard, Menu, MessageCircle, Mic,
  Monitor, MoreHorizontal, Network, Paperclip, Play, Plus, Send, Settings,
  SlidersHorizontal, Sparkles, TerminalSquare, Trash2, Wifi, X, Zap,
} from "lucide-react";
import { isTermuxBridgeAvailable, runTermuxCommand } from "@/lib/termux";
import { checkForUpdate, installUpdate, type UpdateInfo } from "@/lib/app-update";
import { SceneViewport } from "@/components/SceneViewport";

type Agent = { name: string; icon: string; status: "ready" | "busy" | "offline"; color: string };
type Message = { from: "user" | "agent"; text: string; time: string };

const agents: Agent[] = [
  { name: "Kilo Code", icon: "K", status: "ready", color: "#8aa6ff" },
  { name: "Antigravity", icon: "A", status: "busy", color: "#ffb85c" },
  { name: "Freebuff CLI", icon: ">_", status: "ready", color: "#69f0ae" },
];

const idProps = (id: string, hook: string) => ({ id, "data-element-id": id, "data-hook": hook });

function Panel({ id, title, icon, children, onClose, className = "", focused = false, onFocus }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode; onClose?: () => void; className?: string; focused?: boolean; onFocus?: () => void }) {
  return <section {...idProps(id, `panel.${hookName(id)}`)} className={`panel ${className} ${focused ? "panel-focused" : ""}`} onClick={(event) => { event.stopPropagation(); onFocus?.(); }}>
    <header className="panel-header"><div className="panel-title"><span className="panel-icon">{icon}</span>{title}</div><div className="panel-header-actions">{!focused && <span className="tap-hint">detail</span>}{onClose && <button {...idProps(closeId(id), `panel.${hookName(id)}.close`)} className="icon-button" onClick={(event) => { event.stopPropagation(); onClose(); }} aria-label={`Zavřít ${title}`}><X size={16} /></button>}</div></header>
    {children}
  </section>;
}
function hookName(id: string) { return id.toLowerCase().replace("w", "window-"); }
function closeId(id: string) { const num = Number(id.slice(1)); return `C${30 + num}`; }
function actionProps(id: string, hook: string) { return { ...idProps(id, hook), type: "button" as const }; }
function reopenId(id: string) { return `B${40 + Number(id.slice(1))}`; }
function stored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(`agentvr.${key}`);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}

function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => stored(key, fallback));
  useEffect(() => {
    try { window.localStorage.setItem(`agentvr.${key}`, JSON.stringify(value)); } catch { /* storage can be disabled */ }
  }, [key, value]);
  return [value, setValue] as const;
}

export default function Home() {
  const [activeAgent, setActiveAgent] = useState(0);
  const [selectedNav, setSelectedNav] = useStoredState("selected-nav", "Přehled");
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({ W01: true, W02: true, W03: true, W04: true, W05: true, W06: true, W07: true, W08: true, W09: true, W10: true, W11: true });
  const [messages, setMessages] = useStoredState<Message[]>("chat.messages", [{ from: "agent", text: "Systém je připravený. Vyber agenta nebo zadej úkol.", time: "12:00" }]);
  const [draft, setDraft] = useStoredState("chat.draft", "");
  const [sessionCount, setSessionCount] = useState(1);
  const [tool, setTool] = useState("Nástroje");
  const [terminal, setTerminal] = useStoredState<string[]>("demo-terminal.lines", ["> demo-shell ready", "> Bezpečný demo režim — příkazy se nespouštějí v systému."]);
  const [command, setCommand] = useStoredState("demo-terminal.command", "");
  const [metrics, setMetrics] = useState({ cpu: 32, ram: 54, gpu: 18 });
  const [isListening, setIsListening] = useState(false);
  const [focusedPanel, setFocusedPanel] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useStoredState<"chat" | "termux">("workspace.mode", "chat");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [termuxLines, setTermuxLines] = useStoredState<string[]>("termux.lines", ["$ termux bridge: připraven", "$ čekám na příkaz…"]);
  const [termuxCommand, setTermuxCommand] = useStoredState("termux.command", "");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [vrMode, setVrMode] = useStoredState("display.vr", false);

  useEffect(() => {
    const timer = window.setInterval(() => setMetrics(m => ({ cpu: Math.max(12, Math.min(82, m.cpu + (Math.random() > .5 ? 3 : -2))), ram: Math.max(30, Math.min(85, m.ram + (Math.random() > .5 ? 1 : -1))), gpu: Math.max(8, Math.min(72, m.gpu + (Math.random() > .5 ? 4 : -3))) })), 2400);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    checkForUpdate().then(info => { if (active) setUpdateInfo(info); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const orientation = window.screen?.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void>; unlock?: () => void } | undefined;
    if (vrMode) orientation?.lock?.("landscape").catch(() => undefined);
    else orientation?.unlock?.();
  }, [vrMode]);

  const visibleAgents = useMemo(() => agents.map((agent, index) => ({ ...agent, active: activeAgent === index })), [activeAgent]);
  const togglePanel = (id: string) => setOpenPanels(p => ({ ...p, [id]: !p[id] }));

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    // INTEGRATION B16: replace this local adapter with POST /api/chat or a websocket send.
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(m => [...m, { from: "user", text, time: now }]);
    setDraft("");
    window.setTimeout(() => setMessages(m => [...m, { from: "agent", text: `Demo odpověď agenta ${agents[activeAgent].name}: úkol byl přijat k analýze.`, time: now }]), 650);
  };

  const addWorkspaceEvent = (text: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(m => [...m, { from: "agent", text, time }]);
  };

  const runCommand = () => {
    const cmd = command.trim(); if (!cmd) return;
    // INTEGRATION C08: replace with a sandboxed terminal API; never execute raw user input on the app server.
    const response = cmd === "help" ? "Dostupné demo příkazy: help, status, clear" : cmd === "status" ? `agent=${agents[activeAgent].name}; sessions=${sessionCount}; cpu=${metrics.cpu}%` : cmd === "clear" ? "__CLEAR__" : `demo: příkaz '${cmd}' je pouze simulovaný`;
    setTerminal(lines => response === "__CLEAR__" ? [] : [...lines, `> ${cmd}`, response]); setCommand("");
  };

  const runTermux = async () => {
    const cmd = termuxCommand.trim(); if (!cmd) return;
    setTermuxLines(lines => [...lines, `$ ${cmd}`]);
    setTermuxCommand("");
    try {
      const result = await runTermuxCommand(cmd);
      setTermuxLines(lines => [...lines, result.ok ? result.stdout || "(bez výstupu)" : `bridge: ${result.stderr ?? result.reason ?? "chyba"}`]);
    } catch (error) {
      setTermuxLines(lines => [...lines, `bridge: ${error instanceof Error ? error.message : "Termux command failed"}`]);
    }
  };

  const pressKey = (key: string) => {
    if (key === "⌫") { workspaceMode === "termux" ? setTermuxCommand(v => v.slice(0, -1)) : setDraft(v => v.slice(0, -1)); return; }
    if (key === "␣") { workspaceMode === "termux" ? setTermuxCommand(v => `${v} `) : setDraft(v => `${v} `); return; }
    if (key === "↵") { workspaceMode === "termux" ? runTermux() : sendMessage(); return; }
    workspaceMode === "termux" ? setTermuxCommand(v => v + key) : setDraft(v => v + key);
  };

  const toggleDisplayMode = async () => {
    const next = !vrMode;
    setVrMode(next);
    if (next) await document.documentElement.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) await document.exitFullscreen?.().catch(() => undefined);
  };

  const dashboardSurface = (eye: "normal" | "left" | "right" = "normal") => ( <>
    <header className="topbar">
      <div className="brand-mark"><Sparkles size={22} /><div><strong>Insane AI Agent</strong><span>mobilní pracovní plocha</span></div></div>
      <div className="status-strip"><span className="online-dot" /> Online <span className="muted">•</span> Připraveno {updateInfo?.available && <button {...actionProps("B27", "app.update.available")} className="update-pill" onClick={async () => { if (!updateInfo.apk) return; setUpdateBusy(true); await installUpdate(updateInfo.apk); setUpdateBusy(false); }}>{updateBusy ? "Stahuji…" : "Nová APK"}</button>}</div>
      <button {...actionProps("B05", "navigation.settings") } className="top-icon" onClick={() => setSelectedNav("Nastavení")} aria-label="Nastavení"><Settings size={18} /></button><button {...actionProps("B35", "display.vr.toggle")} className={`display-toggle ${vrMode ? "active" : ""}`} onClick={toggleDisplayMode} aria-label="Přepnout zobrazení">{vrMode ? "2D 9:16" : "VR 16:9"}</button>
    </header>

    {updateInfo?.available && <div className="update-banner" role="status"><div><strong>Je dostupná nová verze aplikace</strong><small>Build {updateInfo.run ?? updateInfo.build.slice(0, 8)} z GitHubu</small></div><button {...actionProps("B28", "app.update.install")} className="primary-button" onClick={async () => { if (!updateInfo.apk) return; setUpdateBusy(true); await installUpdate(updateInfo.apk); setUpdateBusy(false); }}>{updateBusy ? "Stahuji APK…" : "Aktualizovat"}</button></div>}

    <div className="origin-strip"><div className="context-card"><span className="context-label">ČAS</span><strong id="C09" data-element-id="C09" data-hook="status.time">12:00</strong><small>St 18. 11. 2026</small></div><div className="context-card"><span className="context-label">POČASÍ</span><strong id="C10" data-element-id="C10" data-hook="status.weather">☀ 6 °C</strong><small>Milovice</small></div><div className="topnav"><button {...actionProps("B01", "navigation.overview")} className={selectedNav === "Přehled" ? "active" : ""} onClick={() => setSelectedNav("Přehled")}><LayoutDashboard size={14} /> Přehled</button><button {...actionProps("B02", "navigation.projects.top")} onClick={() => setSelectedNav("Projekty")}><Folder size={14} /> Projekty</button><button {...actionProps("B03", "navigation.agents.top")} onClick={() => setSelectedNav("Agenti")}><Bot size={14} /> Agenti</button><button {...actionProps("B04", "navigation.terminal.top")} onClick={() => setSelectedNav("Terminál")}><Command size={14} /> Terminál</button></div></div>

    <main className={`dashboard ${focusedPanel ? "has-focus" : ""}`}>
      {eye !== "normal" && <div className="scene-backdrop"><SceneViewport eye={eye} /></div>}
      <div className="welcome-row"><div><p className="eyebrow">STŘEDA · 18. 11. 2026</p><h1>Pracovní plocha agentů</h1><p className="lead">Řiď své AI agenty z jednoho místa.</p></div><div className="quick-actions"><button {...actionProps("B06", "sessions.create")} className="primary-button" onClick={() => setSessionCount(c => c + 1)}><Plus size={16} /> Nová relace</button></div></div>

      <div className="overview-grid">
        {openPanels.W01 && <Panel id="W01" focused={focusedPanel === "W01"} onFocus={() => setFocusedPanel("W01")} title="AI Agenti v akci" icon={<Bot size={17} />} onClose={() => togglePanel("W01")}><div className="agent-hero"><div className="orb"><Bot size={30} /></div><strong>{agents[activeAgent].name}</strong><span className="subtle"><span className="online-dot small" /> {agents[activeAgent].status === "busy" ? "pracuje" : "čeká na úkol"}</span></div></Panel>}
        {openPanels.W02 && <Panel id="W02" focused={focusedPanel === "W02"} onFocus={() => setFocusedPanel("W02")} title="Průběh úkolů" icon={<Activity size={17} />} onClose={() => togglePanel("W02")}><div className="mini-chart"><div className="chart-bars">{[26, 40, 32, 58, 48, 70, 54, 78, 66].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><span>posledních 60 min</span></div></Panel>}
        {openPanels.W03 && <Panel id="W03" focused={focusedPanel === "W03"} onFocus={() => setFocusedPanel("W03")} title="Aktivní úkoly" icon={<Check size={17} />} onClose={() => togglePanel("W03")}><div className="task-list">{["Analyzovat projekt", "Připravit návrh", "Čeká na vstup"].map((task, i) => <div className="task-row" key={task}><span className={`task-check ${i === 0 ? "done" : ""}`}>{i === 0 && <Check size={11} />}</span><span>{task}</span><span className="task-time">{i === 0 ? "běží" : "—"}</span></div>)}</div></Panel>}
        {openPanels.W04 && <Panel id="W04" focused={focusedPanel === "W04"} onFocus={() => setFocusedPanel("W04")} title="Využití systému" icon={<Activity size={17} />} onClose={() => togglePanel("W04")}><div className="metric-grid">{Object.entries(metrics).map(([name, value]) => <div className="metric" key={name}><div className="ring" style={{ "--value": `${value * 3.6}deg` } as React.CSSProperties}><span>{value}%</span></div><small>{name.toUpperCase()}</small></div>)}</div></Panel>}
        {openPanels.W05 && <Panel id="W05" focused={focusedPanel === "W05"} onFocus={() => setFocusedPanel("W05")} title="Tok práce agentů" icon={<Network size={17} />} onClose={() => togglePanel("W05")}><div className="flow-map"><span className="flow-node">vstup</span><i /><span className="flow-core"><Bot size={19} /></span><i /><span className="flow-node">výstup</span></div><small className="flow-caption">agent → orchestrátor → výsledek</small></Panel>}
      </div>

      {openPanels.W06 && <Panel id="W06" focused={focusedPanel === "W06"} onFocus={() => setFocusedPanel("W06")} title="AGENTI & SESSIONS" icon={<Network size={17} />} onClose={() => togglePanel("W06")} className="agents-panel"><div className="session-head"><span>{sessionCount} aktivní relace</span><button {...actionProps("B36", "sessions.create.secondary")} className="icon-button accent" onClick={(event) => { event.stopPropagation(); setSessionCount(c => c + 1); }}><Plus size={16} /></button></div>{visibleAgents.map((agent, index) => <button {...actionProps(`B0${7 + index}`, `agent.select.${agent.name.toLowerCase().replaceAll(" ", "-")}`)} className={`agent-row ${agent.active ? "selected" : ""}`} key={agent.name} onClick={(event) => { event.stopPropagation(); setActiveAgent(index); }}><span className="agent-avatar" style={{ background: agent.color }}>{agent.icon}</span><span className="agent-name">{agent.name}</span><span className={`agent-status ${agent.status}`} />{agent.active && <ChevronRight size={16} />}</button>)}<button {...actionProps("B11", "sessions.history")} className="agent-row history" onClick={(event) => event.stopPropagation()}><History size={17} /><span>Historie sessions</span><ChevronRight size={16} /></button></Panel>}

      <div className="workspace-toggle" onClick={(event) => event.stopPropagation()}><span><Code2 size={15} /> Pracovní režim</span><div className="segmented"><button {...actionProps("B24", "workspace.chat")} className={workspaceMode === "chat" ? "active" : ""} onClick={() => setWorkspaceMode("chat")}><MessageCircle size={14} /> Chat</button><button {...actionProps("B25", "workspace.termux")} className={workspaceMode === "termux" ? "active" : ""} onClick={() => setWorkspaceMode("termux")}><TerminalSquare size={14} /> Termux</button></div><button {...actionProps("C17", "keyboard.toggle")} className={`keyboard-toggle ${keyboardOpen ? "active" : ""}`} onClick={() => setKeyboardOpen(v => !v)} aria-label="Zobrazit klávesnici"><Menu size={16} /> Klávesnice</button></div>

      {openPanels.W07 && <Panel id="W07" focused={focusedPanel === "W07"} onFocus={() => setFocusedPanel("W07")} title={workspaceMode === "chat" ? "Chat & Stream" : "Termux / CLI agenti"} icon={workspaceMode === "chat" ? <MessageCircle size={17} /> : <TerminalSquare size={17} />} onClose={() => togglePanel("W07")} className={`chat-panel ${workspaceMode === "termux" ? "termux-panel" : ""}`}><div className="stream-status"><span className={`online-dot ${workspaceMode === "termux" && !isTermuxBridgeAvailable() ? "offline" : ""}`} /> {workspaceMode === "termux" ? (isTermuxBridgeAvailable() ? "Termux připojen" : "Termux bridge čeká na APK") : "Chat stream"} <button {...actionProps("C05", "chat.stream.select")} className="select-chip" onClick={(event) => { event.stopPropagation(); setTool(tool === "Demo stream" ? "Nástroje" : "Demo stream"); }}>{tool}<ChevronDown size={13} /></button></div>{workspaceMode === "chat" ? <><div className="messages" aria-live="polite">{messages.map((message, i) => <div className={`message ${message.from}`} key={`${message.time}-${i}`}><div className="message-bubble">{message.text}<small>{message.time}</small></div></div>)}</div><div className="chat-toolbar"><button {...actionProps("B12", "chat.tools")} className="tool-button" onClick={(event) => { event.stopPropagation(); setTool(tool === "Nástroje" ? "Akce" : "Nástroje"); }}><SlidersHorizontal size={15} /> {tool}<ChevronDown size={13} /></button><button {...actionProps("B13", "chat.git")} className="tool-button" onClick={(event) => { event.stopPropagation(); addWorkspaceEvent("Git: pracovní strom je čistý; větev main je synchronizovaná."); }}><GitBranch size={15} /> Git</button><button {...actionProps("B14", "chat.files")} className="tool-button" onClick={(event) => { event.stopPropagation(); addWorkspaceEvent("Soubory: otevřen workspace /client a assety scény."); }}><Folder size={15} /> Soubory</button></div><div className="composer"><button {...actionProps("C06", "chat.voice.input")} className={`mic-button ${isListening ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); setIsListening(v => !v); }} aria-label="Hlasový vstup"><Mic size={19} /></button><input {...idProps("C07", "chat.text.input")} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} placeholder={isListening ? "Poslouchám… (demo hook)" : "Zadej příkaz nebo použij hlas…"} /><button {...actionProps("B16", "chat.send")} className="send-button" onClick={(event) => { event.stopPropagation(); sendMessage(); }} aria-label="Odeslat"><Send size={18} /></button></div></> : <><div className="termux-console">{termuxLines.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}</div><div className="terminal-actions"><button {...actionProps("B29", "termux.clear")} onClick={(event) => { event.stopPropagation(); setTermuxLines(["$ termux console cleared"]); }}>Vyčistit</button><button {...actionProps("B30", "termux.reconnect")} onClick={(event) => { event.stopPropagation(); setTermuxLines(lines => [...lines, "$ bridge: reconnect requested"]); }}>Reconnect</button></div><div className="terminal-input"><span>›</span><input {...idProps("C18", "termux.command.input")} value={termuxCommand} onChange={e => setTermuxCommand(e.target.value)} onKeyDown={e => e.key === "Enter" && runTermux()} placeholder="npm, git, agent CLI…" /><button {...actionProps("B26", "termux.run")} onClick={(event) => { event.stopPropagation(); runTermux(); }}><Play size={14} /></button></div><p className="termux-note">V náhledu je bridge odpojený. V APK se příkazy posílají do nativního Termuxu přes RUN_COMMAND.</p></>}</Panel>}

      {keyboardOpen && <div className="keyboard-dock" onClick={(event) => event.stopPropagation()}><div className="keyboard-dock-head"><span><Menu size={14} /> Dotyková klávesnice</span><button {...actionProps("C42", "keyboard.close")} onClick={() => setKeyboardOpen(false)}><X size={15} /></button></div>{[["1","2","3","4","5","6","7","8","9","0"],["Q","W","E","R","T","Z","U","I","O","P"],["A","S","D","F","G","H","J","K","L"],["⌫","⇧","Y","X","C","V","B","N","M","↵"],["␣"]].map((row, rowIndex) => <div className="keyboard-row" key={rowIndex}>{row.map((key, keyIndex) => <button key={key} {...actionProps(`K${rowIndex + 1}${keyIndex + 1}`, `keyboard.key.${key}`)} className={key === "␣" ? "space-key" : ""} onClick={() => pressKey(key)}>{key}</button>)}</div>)}</div>}

      <div className="split-grid">{openPanels.W08 && <Panel id="W08" focused={focusedPanel === "W08"} onFocus={() => setFocusedPanel("W08")} title="CODE DIFF" icon={<Code2 size={17} />} onClose={() => togglePanel("W08")}><div className="diff-file"><span className="file-dot" /> src/agent/worker.ts <span className="diff-count">+8 −2</span></div><pre className="diff"><span>  async function runTask() {'{'}</span><em>+   return agent.execute(task);</em><span>  {'}'}</span></pre><button {...actionProps("B37", "diff.open-file")} className="ghost-button" onClick={(event) => { event.stopPropagation(); addWorkspaceEvent("Diff: otevřen soubor src/agent/worker.ts."); }}>Otevřít soubor <ChevronRight size={14} /></button></Panel>}{openPanels.W09 && <Panel id="W09" focused={focusedPanel === "W09"} onFocus={() => setFocusedPanel("W09")} title="TERMINÁL" icon={<TerminalSquare size={17} />} onClose={() => togglePanel("W09")}><div className="terminal-warning"><Zap size={14} /> Bezpečný demo režim</div><div className="terminal-output">{terminal.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}</div><div className="terminal-actions"><button {...actionProps("B31", "terminal.clear")} onClick={(event) => { event.stopPropagation(); setTerminal(["> demo-shell ready"]); }}>Vyčistit</button><button {...actionProps("B32", "terminal.help")} onClick={(event) => { event.stopPropagation(); setCommand("help"); }}>help</button></div><div className="terminal-input"><span>›</span><input {...idProps("C08", "terminal.command.input")} value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => e.key === "Enter" && runCommand()} placeholder="help, status…" /><button {...actionProps("B15", "terminal.run")} onClick={(event) => { event.stopPropagation(); runCommand(); }}><Play size={14} /></button></div></Panel>}</div>

      <div className="environment-grid">{openPanels.W10 && <Panel id="W10" focused={focusedPanel === "W10"} onFocus={() => setFocusedPanel("W10")} title="Prostředí" icon={<Monitor size={17} />} onClose={() => togglePanel("W10")}><div className="environment-content"><div className="scene-preview"><SceneViewport eye={eye} /><span>3D SCÉNA · GLB</span></div><div className="environment-icon"><Monitor size={20} /></div><div className="environment-copy"><span>VR vývojové prostředí</span><small>InsaneServis · branch main · Android / WebXR</small><div className="vr-status-row"><span className="vr-badge ready">SCENE READY</span><span className="vr-badge">WebXR</span><span className="vr-badge">hot reload</span></div></div><div className="vr-actions"><button {...actionProps("B33", "vr.scene.open")} onClick={(event) => { event.stopPropagation(); setFocusedPanel("W10"); }}>Scéna</button><button {...actionProps("B34", "vr.build")} onClick={(event) => { event.stopPropagation(); setTerminal(lines => [...lines, "> build: kontrola scény dokončena", "> build: připraveno pro APK pipeline"]); }}>Build</button></div></div></Panel>}{openPanels.W11 && <Panel id="W11" focused={focusedPanel === "W11"} onFocus={() => setFocusedPanel("W11")} title="Hlasové ovládání" icon={<Mic size={17} />} onClose={() => togglePanel("W11")}><div className="voice-content"><button {...actionProps("C43", "voice.toggle.secondary")} className={`voice-orb ${isListening ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); setIsListening(v => !v); }}><Mic size={22} /></button><div><strong>{isListening ? "Poslouchám…" : "Řekněte příkaz"}</strong><small>lokální demo hook pro speech-to-text</small></div></div></Panel>}</div>

      <div className="closed-panel-bar">{Object.entries(openPanels).filter(([, open]) => !open).map(([id]) => <button key={id} {...actionProps(reopenId(id), `panel.reopen.${id}`)} onClick={() => togglePanel(id)} className="reopen-chip">Znovu otevřít {id}</button>)}</div>
    </main>

    <nav className="bottom-nav" aria-label="Hlavní navigace"><button {...actionProps("B17", "navigation.projects")} className={selectedNav === "Projekty" ? "active" : ""} onClick={() => setSelectedNav("Projekty")}><Folder size={19} /><span>Projekty</span></button><button {...actionProps("B18", "navigation.agents")} className={selectedNav === "Agenti" ? "active" : ""} onClick={() => setSelectedNav("Agenti")}><Bot size={19} /><span>Agenti</span></button><button {...actionProps("B19", "navigation.chat")} className={selectedNav === "Chat" ? "active" : ""} onClick={() => setSelectedNav("Chat")}><MessageCircle size={19} /><span>Chat</span></button><button {...actionProps("B20", "navigation.diff")} className={selectedNav === "Diffy" ? "active" : ""} onClick={() => setSelectedNav("Diffy")}><Code2 size={19} /><span>Diffy</span></button><button {...actionProps("B21", "navigation.terminal")} className={selectedNav === "Terminál" ? "active" : ""} onClick={() => setSelectedNav("Terminál")}><Command size={19} /><span>Terminál</span></button><button {...actionProps("B22", "navigation.environment")} className={selectedNav === "Prostředí" ? "active" : ""} onClick={() => setSelectedNav("Prostředí")}><Monitor size={19} /><span>Prostředí</span></button></nav>

  </>);

  return <div className={`app-shell ${vrMode ? "mode-vr" : "mode-normal"}`} onClick={() => focusedPanel && setFocusedPanel(null)}>
    {vrMode ? <div className="stereo-stage"><div className="vr-eye vr-eye-left"><div className="vr-eye-surface">{dashboardSurface("left")}</div></div><div className="vr-eye vr-eye-right" aria-hidden="true"><div className="vr-eye-surface">{dashboardSurface("right")}</div></div></div> : <div className="normal-stage">{dashboardSurface("normal")}</div>}
  </div>;
}
