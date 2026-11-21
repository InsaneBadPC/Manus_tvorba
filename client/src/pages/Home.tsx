import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Bot, Brain, Check, ChevronDown, ChevronRight, Code2, Command,
  Folder, GitBranch, History, LayoutDashboard, Menu, MessageCircle, Mic,
  Monitor, Network, Play, Plus, Send, Settings,
  SlidersHorizontal, Sparkles, TerminalSquare, X, Zap,
} from "lucide-react";
import { isTermuxBridgeAvailable, runTermuxCommand } from "@/lib/termux";
import { readForegroundTaskStatus, startForegroundTask } from "@/lib/foreground-task";
import { checkForUpdate, installUpdate, type UpdateInfo } from "@/lib/app-update";
import { readDeviceStatus, type DeviceStatus } from "@/lib/device-status";
import { SceneViewport } from "@/components/SceneViewport";
import { MemoryPanel } from "@/components/MemoryPanel";
import { pickProjectDirectory } from "@/lib/project-storage";
import { parseAgentAvailability, parseWorkspaceFiles } from "@/lib/shell-output";

type Agent = { name: string; icon: string; cli: string; status: "ready" | "busy" | "offline"; color: string };
type Message = { from: "user" | "agent"; text: string; time: string };
type AgentSession = { timestamp: number; size: number; path: string; name: string };
type WorkspaceFile = { path: string; size: number };
type Project = { id: string; name: string; uri: string; termuxPath: string; agentClis: string[]; createdAt: string };

const agents: Agent[] = [
  { name: "Kilo Code", icon: "K", cli: "kilo", status: "ready", color: "#8aa6ff" },
  { name: "Antigravity", icon: "A", cli: "antigravity", status: "busy", color: "#ffb85c" },
  { name: "Freebuff CLI", icon: ">_", cli: "freebuff", status: "ready", color: "#69f0ae" },
];

const idProps = (id: string, hook: string) => ({ id, "data-element-id": id, "data-hook": hook });

function Panel({ id, title, icon, children, onClose, className = "", focused = false, onFocus }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode; onClose?: () => void; className?: string; focused?: boolean; onFocus?: () => void }) {
  return <section {...idProps(id, `panel.${hookName(id)}`)} className={`panel ${className} ${focused ? "panel-focused" : ""}`} onClick={(event) => { event.stopPropagation(); onFocus?.(); }}>
    <header className="panel-header"><div className="panel-title"><span className="panel-icon">{icon}</span>{title}</div><div className="panel-header-actions">{!focused && <span className="tap-hint">detail</span>}{onClose && <button {...idProps(closeId(id), `panel.${hookName(id)}.close`)} className="icon-button" onClick={(event) => { event.stopPropagation(); onClose(); }} aria-label={`Zavřít ${title}`}><X size={16} /></button>}</div></header>
    {children}
  </section>;
}
function hookName(id: string) { return id.toLowerCase().replace("w", "window-"); }
function closeId(id: string) {
  const legendCloseIds: Record<string, string> = { W01: "C11", W02: "C12", W03: "C13", W04: "C14", W05: "C15", W08: "C16", W12: "C44" };
  return legendCloseIds[id] ?? `C${30 + Number(id.slice(1))}`;
}
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
  const [projects, setProjects] = useStoredState<Project[]>("projects", []);
  const [activeProjectId, setActiveProjectId] = useStoredState<string | null>("active-project", null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDirectory, setProjectDirectory] = useState<{ uri: string; termuxPath: string; displayName: string } | null>(null);
  const activeProject = projects.find(project => project.id === activeProjectId) ?? null;
  const projectCwd = activeProject?.termuxPath ?? "~";
  const [selectedNav, setSelectedNav] = useStoredState("selected-nav", "Přehled");
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({ W01: true, W02: true, W03: true, W04: true, W05: true, W06: true, W07: true, W08: true, W09: true, W10: true, W11: true, W12: true });
  const [messages, setMessages] = useStoredState<Message[]>("chat.messages", [{ from: "agent", text: "Systém je připravený. Vyber agenta nebo zadej úkol.", time: "12:00" }]);
  const [runtimeEvents, setRuntimeEvents] = useStoredState<string[]>("runtime.events", []);
  const [draft, setDraft] = useStoredState("chat.draft", "");
  const [backgroundEnabled, setBackgroundEnabled] = useStoredState("chat.background", false);
  const [backgroundTask, setBackgroundTask] = useState<{ id: string; label: string } | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [agentAvailability, setAgentAvailability] = useState<Record<string, Agent["status"]>>({ kilo: "offline", antigravity: "offline", freebuff: "offline" });
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(null);
  const [sessionContent, setSessionContent] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [filesBusy, setFilesBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [tool, setTool] = useState("Nástroje");
  const [shell, setShell] = useState<"Bash" | "Sh">("Bash");
  const [terminal, setTerminal] = useStoredState<string[]>("terminal.lines", ["> Termux bridge: čekám na skutečný příkaz…"]);
  const [command, setCommand] = useStoredState("terminal.command", "");
  const [metrics, setMetrics] = useState<{ cpu: number | null; ram: number | null; gpu: number | null }>({ cpu: null, ram: null, gpu: null });
  const [isListening, setIsListening] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const speechRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const [focusedPanel, setFocusedPanel] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useStoredState<"chat" | "termux">("workspace.mode", "chat");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [termuxLines, setTermuxLines] = useStoredState<string[]>("termux.lines", ["$ termux bridge: připraven", "$ čekám na příkaz…"]);
  const [termuxCommand, setTermuxCommand] = useStoredState("termux.command", "");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [vrMode, setVrMode] = useStoredState("display.vr", false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>({ batteryPercent: null, charging: null, signalDbm: null, networkDownlinkMbps: null, cpuCores: null, ramUsedMb: null, ramTotalMb: null, source: "unavailable" });

  useEffect(() => {
    let active = true;
    checkForUpdate().then(info => { if (active) setUpdateInfo(info); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!backgroundTask) return;
    let active = true;
    const poll = async () => {
      const status = await readForegroundTaskStatus().catch(() => null);
      if (!active || !status || status.running || status.taskId !== backgroundTask.id) return;
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const output = status.output?.trim() || "(úloha nevrátila výstup)";
      const note = status.error ? `\n${status.error}` : `\n(exit ${status.exitCode})`;
      setMessages(m => [...m, { from: "agent", text: `${status.error ? "Úloha selhala" : "Úloha dokončena"}:\n${output}${note}`, time }]);
      setRuntimeEvents(events => [`${time} ${backgroundTask.label}: úloha na pozadí dokončena`, ...events].slice(0, 20));
      setBackgroundTask(null);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [backgroundTask, setMessages, setRuntimeEvents]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => readDeviceStatus().then(status => {
      if (!active) return;
      setDeviceStatus(status);
      if (status.ramUsedMb !== null && status.ramTotalMb) setMetrics(metrics => ({ ...metrics, ram: Math.round((status.ramUsedMb! / status.ramTotalMb!) * 100) }));
    }).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const refreshAgentAvailability = async () => {
    const result = await runTermuxCommand("for cli in kilo antigravity freebuff; do if command -v \"$cli\" >/dev/null 2>&1; then printf '%s\\tok\\n' \"$cli\"; else printf '%s\\toffline\\n' \"$cli\"; fi; done");
    if (!result.ok) return;
    const next: Record<string, Agent["status"]> = { kilo: "offline", antigravity: "offline", freebuff: "offline" };
    parseAgentAvailability(result.stdout, next);
    setAgentAvailability(next);
  };

  useEffect(() => {
    let active = true;
    runTermuxCommand("for cli in kilo antigravity freebuff; do if command -v \"$cli\" >/dev/null 2>&1; then printf '%s\\tok\\n' \"$cli\"; else printf '%s\\toffline\\n' \"$cli\"; fi; done").then(result => {
      if (!active || !result.ok) return;
      const next: Record<string, Agent["status"]> = { kilo: "offline", antigravity: "offline", freebuff: "offline" };
      parseAgentAvailability(result.stdout, next);
      setAgentAvailability(next);
    });
    return () => { active = false; };
  }, []);

  // The right eye is a visual duplicate; React re-adds the ids on every render,
  // so strip them after each render instead of only when vrMode changes.
  useEffect(() => {
    if (!vrMode) return;
    document.querySelectorAll(".vr-eye-right [id]").forEach((element) => element.removeAttribute("id"));
  });

  useEffect(() => {
    const orientation = window.screen?.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void>; unlock?: () => void } | undefined;
    if (vrMode) orientation?.lock?.("landscape").catch(() => undefined);
    else orientation?.unlock?.();
  }, [vrMode]);

  const visibleAgents = useMemo(() => agents.filter(agent => activeProject?.agentClis.includes(agent.cli)).map((agent, index) => ({ ...agent, status: agentAvailability[agent.cli] ?? "offline", active: activeAgent === index })), [activeAgent, activeProject, agentAvailability]);
  const selectedAgent = visibleAgents[activeAgent] ?? null;
  useEffect(() => {
    if (activeAgent !== 0 && activeAgent >= visibleAgents.length) setActiveAgent(0);
  }, [activeAgent, visibleAgents.length]);
  const navigateTo = (nav: string) => {
    setSelectedNav(nav);
    const panelByNav: Record<string, string> = { Agenti: "W06", Chat: "W07", Diffy: "W08", Terminál: "W09", Prostředí: "W10", Nastavení: "W10", Paměť: "W12" };
    const panel = panelByNav[nav];
    if (panel) {
      setOpenPanels(p => ({ ...p, [panel]: true }));
      setFocusedPanel(panel);
      return;
    }
    setFocusedPanel(null);
    const target = nav === "Projekty" ? document.querySelector(".project-bar") : null;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const togglePanel = (id: string) => setOpenPanels(p => ({ ...p, [id]: !p[id] }));

  const shellQuote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;

  const chooseProjectDirectory = async () => {
    try { setProjectDirectory(await pickProjectDirectory()); }
    catch (error) { addWorkspaceEvent(error instanceof Error ? error.message : "Výběr složky selhal."); }
  };

  const createProject = async () => {
    const name = projectName.trim();
    if (!name || !projectDirectory) { addWorkspaceEvent("Projekt: zadej název a vyber skutečnou složku zařízení."); return; }
    const result = await runTermuxCommand(`test -d ${shellQuote(projectDirectory.termuxPath)} && mkdir -p ${shellQuote(`${projectDirectory.termuxPath}/.agentvr`)} && printf '%s\\n' ${shellQuote(JSON.stringify({ name, createdAt: new Date().toISOString() }))} > ${shellQuote(`${projectDirectory.termuxPath}/.agentvr/project.json`)}`);
    if (!result.ok) { addWorkspaceEvent(`Projekt nelze připravit v Termuxu: ${result.stderr ?? result.reason ?? "příkaz selhal"}`); return; }
    const project: Project = { id: crypto.randomUUID(), name, uri: projectDirectory.uri, termuxPath: projectDirectory.termuxPath, agentClis: [], createdAt: new Date().toISOString() };
    setProjects(current => [...current, project]); setActiveProjectId(project.id); setProjectName(""); setProjectDirectory(null); setProjectDialogOpen(false); setActiveAgent(0);
  };

  const toggleProjectAgent = (cli: string) => {
    if (!activeProject) return;
    setProjects(current => current.map(project => project.id === activeProject.id ? { ...project, agentClis: project.agentClis.includes(cli) ? project.agentClis.filter(item => item !== cli) : [...project.agentClis, cli] } : project));
  };

  const sendMessage = async () => {
    const text = draft.trim(); if (!text) return;
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(m => [...m, { from: "user", text, time: now }]);
    setDraft("");
    if (!activeProject) { setMessages(m => [...m, { from: "agent", text: "Nejdřív vytvoř nebo vyber projekt se skutečnou složkou zařízení.", time: now }]); return; }
    const agent = selectedAgent;
    if (!agent) { setMessages(m => [...m, { from: "agent", text: "V aktivním projektu není přiřazený žádný CLI agent.", time: now }]); return; }
    if (agentAvailability[agent.cli] !== "ready") {
      setMessages(m => [...m, { from: "agent", text: `CLI ${agent.cli} není v Termuxu dostupné. Nainstaluj ho nebo nastav jeho příkaz v Termuxu.`, time: now }]);
      return;
    }
    const cliCommand = `printf '%s\n' ${shellQuote(text)} | ${agent.cli}`;
    if (backgroundEnabled) {
      try {
        const task = await startForegroundTask(cliCommand, projectCwd, `Chat – ${agent.name}`);
        setBackgroundTask({ id: task.taskId, label: agent.name });
        setMessages(m => [...m, { from: "agent", text: `${agent.name} běží na pozadí. Výsledek se zobrazí po dokončení, i když aplikaci minimalizuješ.`, time: now }]);
        setRuntimeEvents(events => [`${now} ${agent.name}: dlouhá úloha spuštěna`, ...events].slice(0, 20));
      } catch (error) {
        setMessages(m => [...m, { from: "agent", text: `Úlohu na pozadí nelze spustit: ${error instanceof Error ? error.message : "neznámá chyba"}`, time: now }]);
      }
      return;
    }
    const result = await runTermuxCommand(cliCommand, projectCwd);
    const output = result.ok ? (result.stdout || "(CLI nevrátil výstup)") : `CLI ${agent.cli}: ${result.stderr ?? result.reason ?? "příkaz selhal"}`;
    setMessages(m => [...m, { from: "agent", text: output, time: now }]);
  };

  const addWorkspaceEvent = (text: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(m => [...m, { from: "agent", text, time }]);
    setRuntimeEvents(events => [`${time} ${text}`, ...events].slice(0, 20));
  };

  const runCommand = async () => {
    const cmd = command.trim(); if (!cmd) return;
    setTerminal(lines => [...lines, `${shell} $ ${cmd}`]); setCommand("");
    const result = await runTermuxCommand(cmd, projectCwd, shell === "Bash" ? "bash" : "sh");
    setTerminal(lines => [...lines, result.ok ? (result.stdout || "(bez výstupu)") : `bridge: ${result.stderr ?? result.reason ?? "příkaz selhal"}`]);
  };

  const runWorkspaceCommand = async (label: string, cmd: string) => {
    if (!activeProject) { addWorkspaceEvent(`${label}: nejdřív vyber projekt.`); return; }
    const result = await runTermuxCommand(cmd, projectCwd);
    addWorkspaceEvent(`${label}: ${result.ok ? result.stdout || "(bez výstupu)" : result.stderr ?? result.reason ?? "příkaz selhal"}`);
  };

  const runCollaborativeTask = async () => {
    if (!activeProject) { addWorkspaceEvent("Spolupráce agentů: nejdřív vyber projekt."); return; }
    const task = draft.trim() || "Analyzuj aktuální projekt a navrhni další vývojový krok.";
    const available = agents.filter(agent => agentAvailability[agent.cli] === "ready");
    if (!available.length) { addWorkspaceEvent("Spolupráce agentů: v Termuxu není dostupný žádný nakonfigurovaný CLI agent."); return; }
    const results = await Promise.all(available.map(agent => runTermuxCommand(`printf '%s\n' ${shellQuote(task)} | ${agent.cli}`, projectCwd)));
    results.forEach((result, index) => addWorkspaceEvent(`${available[index].name}: ${result.ok ? result.stdout || "(bez výstupu)" : result.stderr ?? result.reason ?? "příkaz selhal"}`));
  };

  const loadAgentSessions = async () => {
    if (!activeProject) { addWorkspaceEvent("Historie sessions: nejdřív vyber projekt."); return; }
    setSessionsBusy(true);
    const discovery = "find . -type f \( -iname '*session*' -o -iname '*conversation*' -o -iname '*.jsonl' \) -not -path '*/node_modules/*' -not -path '*/.git/*' -printf '%T@\\t%s\\t%p\\n' 2>/dev/null | sort -rn | head -200";
    const result = await runTermuxCommand(discovery, projectCwd);
    if (!result.ok) {
      setAgentSessions([]);
      addWorkspaceEvent(`Historie sessions: ${result.stderr ?? result.reason ?? "Termux bridge není dostupný"}`);
      setSessionsLoaded(true);
      setSessionsBusy(false);
      return;
    }
    const parsed = result.stdout.split("\n").map(line => {
      const [timestamp, size, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t").trim();
      if (!path || !timestamp || !size) return null;
      return { timestamp: Number(timestamp), size: Number(size), path, name: path.split("/").pop() || path };
    }).filter((session): session is AgentSession => Boolean(session && Number.isFinite(session.timestamp) && Number.isFinite(session.size)));
    setAgentSessions(parsed);
    setSessionCount(parsed.length);
    setSessionsLoaded(true);
    setSessionsBusy(false);
    addWorkspaceEvent(`Historie sessions: načteno ${parsed.length} souborů z Termuxu.`);
  };

  const openAgentSession = async (session: AgentSession) => {
    setSelectedSession(session);
    const result = await runTermuxCommand(`tail -n 120 -- ${shellQuote(session.path)}`, projectCwd);
    setSessionContent(result.ok ? (result.stdout || "(session je prázdná)") : `Nelze načíst session: ${result.stderr ?? result.reason ?? "příkaz selhal"}`);
  };

  const createWorkspaceSession = async () => {
    if (!activeProject) { addWorkspaceEvent("Nová relace: nejdřív vyber projekt."); return; }
    const agent = selectedAgent;
    if (!agent) { addWorkspaceEvent("Nová relace: aktivní projekt nemá přiřazeného CLI agenta."); return; }
    const command = `mkdir -p .agentvr/sessions && file=".agentvr/sessions/session-$(date +%Y%m%d-%H%M%S).json" && printf '{"agent":"%s","cli":"%s","created":"%s"}\\n' ${shellQuote(agent.name)} ${shellQuote(agent.cli)} "$(date -Iseconds)" > "$file" && printf '%s' "$file"`;
    const result = await runTermuxCommand(command, projectCwd);
    if (!result.ok) { addWorkspaceEvent(`Nová relace: ${result.stderr ?? result.reason ?? "Termux bridge není dostupný"}`); return; }
    setSessionCount(count => count + 1);
    addWorkspaceEvent(`Nová skutečná relace zapsána: ${result.stdout.trim()}`);
    await loadAgentSessions();
  };

  const loadWorkspaceFiles = async () => {
    if (!activeProject) { addWorkspaceEvent("Soubory: nejdřív vyber projekt."); return; }
    setFilesBusy(true);
    const result = await runTermuxCommand("find . -maxdepth 3 -type f -not -path './.git/*' -not -path './node_modules/*' -printf '%s\\t%p\\n' 2>/dev/null | sort -k2 | head -200", projectCwd);
    if (!result.ok) { addWorkspaceEvent(`Soubory: ${result.stderr ?? result.reason ?? "Termux bridge není dostupný"}`); setFilesBusy(false); return; }
    const files = parseWorkspaceFiles(result.stdout);
    setWorkspaceFiles(files); setFilesBusy(false); addWorkspaceEvent(`Soubory: načteno ${files.length} položek z ${projectCwd}.`);
  };

  const openWorkspaceFile = async (file: WorkspaceFile) => {
    setSelectedFile(file.path);
    const result = await runTermuxCommand(`sed -n '1,220p' -- ${shellQuote(file.path)}`, projectCwd);
    setFileContent(result.ok ? (result.stdout || "(soubor je prázdný)") : `Nelze otevřít soubor: ${result.stderr ?? result.reason ?? "příkaz selhal"}`);
  };

  const runTermux = async () => {
    const cmd = termuxCommand.trim(); if (!cmd) return;
    setTermuxLines(lines => [...lines, `$ ${cmd}`]);
    setTermuxCommand("");
    try {
      const result = await runTermuxCommand(cmd, projectCwd, shell === "Bash" ? "bash" : "sh");
      setTermuxLines(lines => [...lines, result.ok ? result.stdout || "(bez výstupu)" : `bridge: ${result.stderr ?? result.reason ?? "chyba"}`]);
    } catch (error) {
      setTermuxLines(lines => [...lines, `bridge: ${error instanceof Error ? error.message : "Termux command failed"}`]);
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) { speechRef.current?.stop(); setIsListening(false); return; }
    const SpeechRecognition = (window as Window & { SpeechRecognition?: new () => { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null } ; webkitSpeechRecognition?: new () => { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null } }).SpeechRecognition ?? (window as Window & { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!SpeechRecognition) { addWorkspaceEvent("Hlasové ovládání není v tomto Android/WebView runtime dostupné."); return; }
    const recognition = new SpeechRecognition(); recognition.lang = "cs-CZ"; recognition.interimResults = false; recognition.continuous = false;
    recognition.onresult = event => setDraft(event.results[0][0].transcript);
    recognition.onerror = () => { setIsListening(false); addWorkspaceEvent("Hlasové ovládání: Speech Recognition vrátilo chybu."); };
    recognition.onend = () => { setIsListening(false); speechRef.current = null; };
    speechRef.current = recognition; setIsListening(true); recognition.start();
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

  const handleScenePartClick = (part: string) => {
    if (/^W\d{2}$/.test(part)) { setFocusedPanel(part); return; }
    if (part.includes("navigace_horní")) { navigateTo("Přehled"); return; }
    if (part.includes("navigace_spodní")) { navigateTo("Prostředí"); return; }
    if (part === "stav") { navigateTo("Nastavení"); }
  };

  const dashboardSurface = (eye: "normal" | "left" | "right" = "normal") => ( <>
    <header className="topbar">
      <div className="brand-mark"><Sparkles size={22} /><div><strong>Insane AI Agent</strong><span>mobilní pracovní plocha</span></div></div>
      <div className="status-strip"><span id="C01" data-element-id="C01" data-hook="status.online"><span className={`online-dot ${navigator.onLine ? "" : "offline"}`} /> {navigator.onLine ? "Online" : "Offline"}</span><span className="muted">•</span><span id="C02" data-element-id="C02" data-hook="status.wifi">{navigator.onLine ? "Síť" : "Offline"}</span><span id="C03" data-element-id="C03" data-hook="status.display">Displej</span><span id="C04" data-element-id="C04" data-hook="status.signal">{deviceStatus.signalDbm === null ? "Signál —" : `Signál ${deviceStatus.signalDbm} dBm`}</span><span className="device-status-chip" data-hook="device.battery">Baterie {deviceStatus.batteryPercent === null ? "—" : `${deviceStatus.batteryPercent}%${deviceStatus.charging ? " ⚡" : ""}`}</span><span className="device-status-chip" data-hook="device.network">Síť {deviceStatus.networkDownlinkMbps === null ? "—" : `${deviceStatus.networkDownlinkMbps.toFixed(1)} Mb/s`}</span><span className="device-status-chip" data-hook="device.cpu">CPU {deviceStatus.cpuCores === null ? "—" : `${deviceStatus.cpuCores} jader`}</span><span className="device-status-chip" data-hook="device.ram">RAM {deviceStatus.ramUsedMb !== null && deviceStatus.ramTotalMb ? `${deviceStatus.ramUsedMb}/${deviceStatus.ramTotalMb} MB` : "—"}</span><span className="muted">•</span> Připraveno {updateInfo?.available && <button {...actionProps("B27", "app.update.available")} className="update-pill" onClick={async () => { if (!updateInfo.apk) return; setUpdateBusy(true); await installUpdate(updateInfo.apk, updateInfo.sha256); setUpdateBusy(false); }}>{updateBusy ? "Stahuji…" : "Nová APK"}</button>}</div>
      <button {...actionProps("B05", "navigation.settings") } className={`top-icon ${selectedNav === "Nastavení" ? "active" : ""}`} onClick={() => navigateTo("Nastavení")} aria-label="Nastavení"><Settings size={18} /></button><button {...actionProps("B35", "display.vr.toggle")} className={`display-toggle ${vrMode ? "active" : ""}`} onClick={toggleDisplayMode} aria-label="Přepnout zobrazení">{vrMode ? "2D 9:16" : "VR 16:9"}</button>
    </header>

    {updateInfo?.available && <div className="update-banner" role="status"><div><strong>Je dostupná nová verze aplikace</strong><small>Build {updateInfo.run ?? updateInfo.build.slice(0, 8)} z GitHubu</small></div><button {...actionProps("B28", "app.update.install")} className="primary-button" onClick={async () => { if (!updateInfo.apk) return; setUpdateBusy(true); await installUpdate(updateInfo.apk, updateInfo.sha256); setUpdateBusy(false); }}>{updateBusy ? "Stahuji APK…" : "Aktualizovat"}</button></div>}

    <div className="origin-strip"><div className="context-card"><span className="context-label">ČAS</span><strong id="C09" data-element-id="C09" data-hook="status.time">{now.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</strong><small>{now.toLocaleDateString("cs-CZ")}</small></div><div className="context-card"><span className="context-label">POČASÍ</span><strong id="C10" data-element-id="C10" data-hook="status.weather">N/A</strong><small>Počasí není připojeno</small></div><div className="topnav"><button {...actionProps("B01", "navigation.overview")} className={selectedNav === "Přehled" ? "active" : ""} onClick={() => navigateTo("Přehled")}><LayoutDashboard size={14} /> Přehled</button><button {...actionProps("B02", "navigation.projects.top")} className={selectedNav === "Projekty" ? "active" : ""} onClick={() => navigateTo("Projekty")}><Folder size={14} /> Projekty</button><button {...actionProps("B03", "navigation.agents.top")} className={selectedNav === "Agenti" ? "active" : ""} onClick={() => navigateTo("Agenti")}><Bot size={14} /> Agenti</button>  <button {...actionProps("B04", "navigation.terminal.top")} className={selectedNav === "Terminál" ? "active" : ""} onClick={() => navigateTo("Terminál")}><Command size={14} /> Terminál</button><button {...actionProps("B38", "navigation.memory.top")} className={selectedNav === "Paměť" ? "active" : ""} onClick={() => navigateTo("Paměť")}><Brain size={14} /> Paměť</button></div></div>

    <main className={`dashboard ${focusedPanel ? "has-focus" : ""}`}>
      <div className="welcome-row"><div><p className="eyebrow">{now.toLocaleDateString("cs-CZ", { weekday: "long" }).toUpperCase()}</p><h1>Pracovní plocha agentů</h1><p className="lead">Řiď své AI agenty z jednoho místa.</p></div><div className="quick-actions"><button {...actionProps("B06", "sessions.create")} className="primary-button" onClick={() => void createWorkspaceSession()} disabled={!activeProject}><Plus size={16} /> Nová relace</button></div></div>

      <div className="project-bar"><label>Aktivní projekt</label><select value={activeProjectId ?? ""} onChange={event => { setActiveProjectId(event.target.value || null); setActiveAgent(0); }}><option value="">Vyber nebo vytvoř projekt…</option>{projects.map(project => <option value={project.id} key={project.id}>{project.name} · {project.termuxPath}</option>)}</select><button className="primary-button" onClick={() => setProjectDialogOpen(value => !value)}><Plus size={15} /> Nový projekt</button>{activeProject && <small>{activeProject.termuxPath} · {activeProject.agentClis.length} přiřazených agentů</small>}</div>
      {projectDialogOpen && <div className="project-dialog"><strong>Nový projekt ve sdíleném úložišti</strong><input value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="Název projektu" /><button className="ghost-button" onClick={() => void chooseProjectDirectory()}>{projectDirectory ? `Vybráno: ${projectDirectory.displayName}` : "Vybrat složku zařízení"}</button>{projectDirectory && <small>{projectDirectory.termuxPath} · přístupné správci souborů</small>}<div className="project-dialog-actions"><button className="ghost-button" onClick={() => setProjectDialogOpen(false)}>Zrušit</button><button className="primary-button" onClick={() => void createProject()}>Vytvořit projekt</button></div></div>}

      <div className="overview-grid">
        {openPanels.W01 && <Panel id="W01" focused={focusedPanel === "W01"} onFocus={() => setFocusedPanel("W01")} title="AI Agenti v akci" icon={<Bot size={17} />} onClose={() => togglePanel("W01")}><div className="agent-hero"><div className="orb"><Bot size={30} /></div><strong>{selectedAgent?.name ?? "Bez agenta"}</strong><span className="subtle"><span className={`online-dot small ${selectedAgent?.status === "offline" ? "offline" : ""}`} /> {!selectedAgent ? "vyber projekt a agenta" : selectedAgent.status === "offline" ? "CLI není dostupné" : selectedAgent.status === "busy" ? "pracuje" : "čeká na úkol"}</span></div></Panel>}
        {openPanels.W02 && <Panel id="W02" focused={focusedPanel === "W02"} onFocus={() => setFocusedPanel("W02")} title="Průběh úkolů" icon={<Activity size={17} />} onClose={() => togglePanel("W02")}><div className="runtime-list">{runtimeEvents.length ? runtimeEvents.slice(0, 5).map(event => <div className="runtime-event" key={event}>{event}</div>) : <span className="subtle">Čeká na skutečné spuštění úlohy.</span>}</div></Panel>}
        {openPanels.W03 && <Panel id="W03" focused={focusedPanel === "W03"} onFocus={() => setFocusedPanel("W03")} title="Aktivní úkoly" icon={<Check size={17} />} onClose={() => togglePanel("W03")}><div className="task-list">{runtimeEvents.slice(0, 3).map(event => <div className="task-row" key={event}><span className="task-check"><Activity size={11} /></span><span>{event}</span><span className="task-time">záznam</span></div>)}{runtimeEvents.length === 0 && <span className="subtle">Žádné skutečné úlohy neběží.</span>}</div></Panel>}
        {openPanels.W04 && <Panel id="W04" focused={focusedPanel === "W04"} onFocus={() => setFocusedPanel("W04")} title="Využití systému" icon={<Activity size={17} />} onClose={() => togglePanel("W04")}><div className="metric-grid">{Object.entries(metrics).map(([name, value]) => <div className="metric" key={name}><div className="ring" style={{ "--value": `${(value ?? 0) * 3.6}deg` } as React.CSSProperties}><span>{value === null ? "N/A" : `${value}%`}</span></div><small>{name.toUpperCase()}</small></div>)}</div></Panel>}
        {openPanels.W05 && <Panel id="W05" focused={focusedPanel === "W05"} onFocus={() => setFocusedPanel("W05")} title="Tok práce agentů" icon={<Network size={17} />} onClose={() => togglePanel("W05")}><div className="flow-map"><span className="flow-node">Termux</span><i /><span className="flow-core"><Bot size={19} /></span><i /><span className="flow-node">CLI výstup</span></div><small className="flow-caption">{runtimeEvents.length ? `${runtimeEvents.length} skutečných runtime událostí` : "Čeká na skutečné spuštění CLI agenta"}</small></Panel>}
      </div>

      {openPanels.W06 && <Panel id="W06" focused={focusedPanel === "W06"} onFocus={() => setFocusedPanel("W06")} title="AGENTI & SESSIONS" icon={<Network size={17} />} onClose={() => togglePanel("W06")} className="agents-panel"><div className="session-head"><span>{sessionCount} aktivní relace</span><button {...actionProps("B36", "sessions.create.secondary")} className="icon-button accent" onClick={(event) => { event.stopPropagation(); void createWorkspaceSession(); }}><Plus size={16} /></button></div><button {...actionProps("B07", "agent.active")} className="agent-row selected" onClick={(event) => { event.stopPropagation(); void refreshAgentAvailability(); }}><span className="agent-avatar" style={{ background: visibleAgents[activeAgent]?.color ?? "#45516f" }}>{visibleAgents[activeAgent]?.icon ?? "—"}</span><span className="agent-name">Aktivní agent: {activeProject ? (visibleAgents[activeAgent]?.name ?? "Bez přiřazeného agenta") : "Bez projektu"}</span><span className={`agent-status ${visibleAgents[activeAgent]?.status ?? "offline"}`} /><ChevronRight size={16} /></button>{visibleAgents.map((agent, index) => <button {...actionProps(`B${String(8 + index).padStart(2, "0")}`, `agent.select.${agent.name.toLowerCase().replaceAll(" ", "-")}`)} className={`agent-row ${agent.active ? "selected" : ""}`} key={agent.name} onClick={(event) => { event.stopPropagation(); setActiveAgent(index); }}><span className="agent-avatar" style={{ background: agent.color }}>{agent.icon}</span><span className="agent-name">{agent.name}</span><span className={`agent-status ${agent.status}`} />{agent.active && <ChevronRight size={16} />}</button>)}{activeProject && <div className="project-agent-controls"><small>Přiřazení agentů k projektu</small>{agents.filter(agent => !activeProject.agentClis.includes(agent.cli)).map(agent => <button className="agent-manage add" key={`add-${agent.cli}`} onClick={(event) => { event.stopPropagation(); toggleProjectAgent(agent.cli); }}>+ {agent.name}</button>)}{visibleAgents.map(agent => <button className="agent-manage remove" key={`remove-${agent.cli}`} onClick={(event) => { event.stopPropagation(); toggleProjectAgent(agent.cli); }}>− {agent.name}</button>)}</div>}<button {...actionProps("B11", "sessions.history")} className="agent-row history" onClick={(event) => { event.stopPropagation(); void loadAgentSessions(); }}><History size={17} /><span>{sessionsBusy ? "Načítám sessions z Termuxu…" : "Historie sessions z Termuxu"}</span><ChevronRight size={16} /></button>{sessionsLoaded && <div className="session-history" onClick={event => event.stopPropagation()}>{agentSessions.length === 0 ? <span className="subtle">Nenalezen žádný session/conversation soubor v HOME Termuxu.</span> : agentSessions.map(session => <button className="session-file" key={session.path} onClick={() => void openAgentSession(session)}><span>{session.name}</span><small>{session.path} · {Math.round(session.size / 1024)} KB</small></button>)}{selectedSession && <div className="session-preview"><strong>{selectedSession.name}</strong><pre>{sessionContent || "Načítám obsah…"}</pre></div>}</div>}</Panel>}

      <div className="workspace-toggle" onClick={(event) => event.stopPropagation()}><span><Code2 size={15} /> Pracovní režim</span><div className="segmented"><button {...actionProps("B24", "workspace.chat")} className={workspaceMode === "chat" ? "active" : ""} onClick={() => setWorkspaceMode("chat")}><MessageCircle size={14} /> Chat</button><button {...actionProps("B25", "workspace.termux")} className={workspaceMode === "termux" ? "active" : ""} onClick={() => setWorkspaceMode("termux")}><TerminalSquare size={14} /> Termux</button></div><button {...actionProps("C17", "keyboard.toggle")} className={`keyboard-toggle ${keyboardOpen ? "active" : ""}`} onClick={() => setKeyboardOpen(v => !v)} aria-label="Zobrazit klávesnici"><Menu size={16} /> Klávesnice</button></div>

      {openPanels.W07 && <Panel id="W07" focused={focusedPanel === "W07"} onFocus={() => setFocusedPanel("W07")} title={workspaceMode === "chat" ? "Chat & Stream" : "Termux / CLI agenti"} icon={workspaceMode === "chat" ? <MessageCircle size={17} /> : <TerminalSquare size={17} />} onClose={() => togglePanel("W07")} className={`chat-panel ${workspaceMode === "termux" ? "termux-panel" : ""}`}><div className="stream-status"><span className={`online-dot ${workspaceMode === "termux" && !isTermuxBridgeAvailable() ? "offline" : ""}`} /> {workspaceMode === "termux" ? (isTermuxBridgeAvailable() ? "Termux připojen" : "Termux bridge čeká na APK") : "Chat stream"} <button {...actionProps("C05", "chat.stream.select")} className="select-chip" onClick={(event) => { event.stopPropagation(); setTool(tool === "Akce" ? "Nástroje" : "Akce"); }}>{tool}<ChevronDown size={13} /></button></div>{workspaceMode === "chat" ? <><div className="messages" aria-live="polite">{messages.map((message, i) => <div className={`message ${message.from}`} key={`${message.time}-${i}`}><div className="message-bubble">{message.text}<small>{message.time}</small></div></div>)}</div><div className="chat-toolbar"><button {...actionProps("B12", "chat.tools")} className="tool-button" onClick={(event) => { event.stopPropagation(); setTool(tool === "Nástroje" ? "Akce" : "Nástroje"); }}><SlidersHorizontal size={15} /> {tool}<ChevronDown size={13} /></button><button {...actionProps("B13", "chat.git")} className="tool-button" onClick={(event) => { event.stopPropagation(); void runWorkspaceCommand("Git", "git status --short --branch"); }}><GitBranch size={15} /> Git</button><button {...actionProps("B14", "chat.files")} className="tool-button" onClick={(event) => { event.stopPropagation(); void loadWorkspaceFiles(); }}><Folder size={15} /> Soubory</button><button {...actionProps("B23", "agents.collaborate")} className="tool-button" onClick={(event) => { event.stopPropagation(); void runCollaborativeTask(); }}><Network size={15} /> Všichni agenti</button><button {...actionProps("B39", "chat.background")} className={`tool-button ${backgroundEnabled ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); setBackgroundEnabled(value => !value); }} title="Spustit dlouhý příkaz přes Android foreground service"><Zap size={15} /> {backgroundTask ? "Běží…" : "Na pozadí"}</button></div>{workspaceFiles.length > 0 && <div className="workspace-files" onClick={event => event.stopPropagation()}><div className="workspace-files-head"><span>{filesBusy ? "Načítám soubory…" : `${workspaceFiles.length} souborů`}</span><button onClick={() => void loadWorkspaceFiles()}>Obnovit</button></div>{workspaceFiles.slice(0, 30).map(file => <button className="workspace-file" key={file.path} onClick={() => void openWorkspaceFile(file)}><span>{file.path}</span><small>{Math.round(file.size / 1024)} KB</small></button>)}{selectedFile && <pre className="file-preview"><strong>{selectedFile}</strong>{fileContent || "Načítám…"}</pre>}</div>}<div className="composer"><button {...actionProps("C06", "chat.voice.input")} className={`mic-button ${isListening ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); toggleVoiceInput(); }} aria-label="Hlasový vstup"><Mic size={19} /></button><input {...idProps("C07", "chat.text.input")} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} placeholder={isListening ? "Poslouchám…" : "Zadej příkaz nebo použij hlas…"} /><button {...actionProps("B16", "chat.send")} className="send-button" onClick={(event) => { event.stopPropagation(); sendMessage(); }} aria-label="Odeslat"><Send size={18} /></button></div></> : <><div className="termux-console">{termuxLines.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}</div><div className="terminal-actions"><button {...actionProps("B29", "termux.clear")} onClick={(event) => { event.stopPropagation(); setTermuxLines(["$ console cleared"]); }}>Vyčistit</button><button {...actionProps("B30", "termux.reconnect")} onClick={(event) => { event.stopPropagation(); setTermuxLines(lines => [...lines, "$ bridge: reconnect requested"]); }}>Reconnect</button></div><div className="terminal-input"><span>›</span><input {...idProps("C18", "termux.command.input")} value={termuxCommand} onChange={e => setTermuxCommand(e.target.value)} onKeyDown={e => e.key === "Enter" && runTermux()} placeholder="npm, git, agent CLI…" /><button {...actionProps("B26", "termux.run")} onClick={(event) => { event.stopPropagation(); runTermux(); }}><Play size={14} /></button></div><p className="termux-note">Příkazy se posílají do nativního Termuxu přes RUN_COMMAND; bez bridge se zobrazí skutečná chyba připojení.</p></>}</Panel>}

      {keyboardOpen && <div className="keyboard-dock" onClick={(event) => event.stopPropagation()}><div className="keyboard-dock-head"><span><Menu size={14} /> Dotyková klávesnice</span><button {...actionProps("C42", "keyboard.close")} onClick={() => setKeyboardOpen(false)}><X size={15} /></button></div>{[["1","2","3","4","5","6","7","8","9","0"],["Q","W","E","R","T","Z","U","I","O","P"],["A","S","D","F","G","H","J","K","L"],["⌫","⇧","Y","X","C","V","B","N","M","↵"],["␣"]].map((row, rowIndex) => <div className="keyboard-row" key={rowIndex}>{row.map((key, keyIndex) => <button key={key} {...actionProps(`K${rowIndex + 1}${keyIndex + 1}`, `keyboard.key.${key}`)} className={key === "␣" ? "space-key" : ""} onClick={() => pressKey(key)}>{key}</button>)}</div>)}</div>}

      <div className="split-grid">{openPanels.W08 && <Panel id="W08" focused={focusedPanel === "W08"} onFocus={() => setFocusedPanel("W08")} title="CODE DIFF" icon={<Code2 size={17} />} onClose={() => togglePanel("W08")}><div className="diff-file"><span className="file-dot" /> skutečný git diff</div><pre className="diff"><span>{runtimeEvents.find(event => event.includes("Diff:")) ?? "Klikni na tlačítko níže pro načtení skutečného diffu."}</span></pre><button {...actionProps("B37", "diff.open-file")} className="ghost-button" onClick={(event) => { event.stopPropagation(); void runWorkspaceCommand("Diff", "git diff"); }}>Načíst diff <ChevronRight size={14} /></button></Panel>}{openPanels.W09 && <Panel id="W09" focused={focusedPanel === "W09"} onFocus={() => setFocusedPanel("W09")} title="TERMINÁL" icon={<TerminalSquare size={17} />} onClose={() => togglePanel("W09")}><div className="terminal-warning"><Zap size={14} /> Termux bridge <button {...actionProps("C08", "terminal.shell.select")} className="select-chip" onClick={(event) => { event.stopPropagation(); setShell(value => value === "Bash" ? "Sh" : "Bash"); }}>{shell}<ChevronDown size={13} /></button></div><div className="terminal-output">{terminal.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}</div><div className="terminal-actions"><button {...actionProps("B31", "terminal.clear")} onClick={(event) => { event.stopPropagation(); setTerminal(["> terminal cleared"]); }}>Vyčistit</button><button {...actionProps("B32", "terminal.help")} onClick={(event) => { event.stopPropagation(); setCommand("help"); }}>help</button></div><div className="terminal-input"><span>›</span><input {...idProps("C21", "terminal.command.input")} value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => e.key === "Enter" && runCommand()} placeholder="help, status…" /><button {...actionProps("B15", "terminal.run")} onClick={(event) => { event.stopPropagation(); runCommand(); }}><Play size={14} /></button></div></Panel>}</div>

      {!vrMode && openPanels.W12 && <Panel id="W12" focused={focusedPanel === "W12"} onFocus={() => setFocusedPanel("W12")} title="PAMĚŤ, SKILLY A SCHVÁLENÍ" icon={<Brain size={17} />} onClose={() => togglePanel("W12")}><MemoryPanel projectId={activeProjectId ?? ""} projectCwd={projectCwd} /></Panel>}

      <div className="environment-grid">{openPanels.W10 && <Panel id="W10" focused={focusedPanel === "W10"} onFocus={() => setFocusedPanel("W10")} title="Prostředí" icon={<Monitor size={17} />} onClose={() => togglePanel("W10")}><div className="environment-content"><div className="scene-preview"><SceneViewport eye={eye} /><span>3D SCÉNA · GLB</span></div><div className="environment-icon"><Monitor size={20} /></div><div className="environment-copy"><span>VR vývojové prostředí</span><small>InsaneServis · branch main · Android / WebXR</small><div className="vr-status-row"><span className="vr-badge ready">GLB renderer</span><span className="vr-badge">WebGL</span></div></div><div className="vr-actions"><button {...actionProps("B33", "vr.scene.open")} onClick={(event) => { event.stopPropagation(); setFocusedPanel("W10"); }}>Scéna</button><button {...actionProps("B34", "vr.build")} onClick={(event) => { event.stopPropagation(); void runWorkspaceCommand("Build", "pnpm check && pnpm build"); }}>Build</button></div></div></Panel>}{openPanels.W11 && <Panel id="W11" focused={focusedPanel === "W11"} onFocus={() => setFocusedPanel("W11")} title="Hlasové ovládání" icon={<Mic size={17} />} onClose={() => togglePanel("W11")}><div className="voice-content"><button {...actionProps("C43", "voice.toggle.secondary")} className={`voice-orb ${isListening ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); toggleVoiceInput(); }}><Mic size={22} /></button><div><strong>{isListening ? "Poslouchám…" : "Řekněte příkaz"}</strong><small>Speech Recognition API; při nedostupnosti se zobrazí skutečná chyba</small></div></div></Panel>}</div>

      <div className="closed-panel-bar">{Object.entries(openPanels).filter(([, open]) => !open).map(([id]) => <button key={id} {...actionProps(reopenId(id), `panel.reopen.${id}`)} onClick={() => togglePanel(id)} className="reopen-chip">Znovu otevřít {id}</button>)}</div>
    </main>

    <nav className="bottom-nav" aria-label="Hlavní navigace"><button {...actionProps("B17", "navigation.projects")} className={selectedNav === "Projekty" ? "active" : ""} onClick={() => navigateTo("Projekty")}><Folder size={19} /><span>Projekty</span></button><button {...actionProps("B18", "navigation.agents")} className={selectedNav === "Agenti" ? "active" : ""} onClick={() => navigateTo("Agenti")}><Bot size={19} /><span>Agenti</span></button><button {...actionProps("B19", "navigation.chat")} className={selectedNav === "Chat" ? "active" : ""} onClick={() => navigateTo("Chat")}><MessageCircle size={19} /><span>Chat</span></button><button {...actionProps("B20", "navigation.diff")} className={selectedNav === "Diffy" ? "active" : ""} onClick={() => navigateTo("Diffy")}><Code2 size={19} /><span>Diffy</span></button><button {...actionProps("B21", "navigation.terminal")} className={selectedNav === "Terminál" ? "active" : ""} onClick={() => navigateTo("Terminál")}><Command size={19} /><span>Terminál</span></button><button {...actionProps("B22", "navigation.environment")} className={selectedNav === "Prostředí" ? "active" : ""} onClick={() => navigateTo("Prostředí")}><Monitor size={19} /><span>Nastavení VR</span></button></nav>

  </>);

  return <div className={`app-shell ${vrMode ? "mode-vr" : "mode-normal"}`} onClick={() => focusedPanel && !vrMode && setFocusedPanel(null)}>
    {vrMode ? <div className="stereo-stage"><div className="vr-eye vr-eye-left"><div className="vr-eye-surface"><div className="scene-main"><SceneViewport eye="left" onPartClick={handleScenePartClick} /></div>{dashboardSurface("left")}</div></div><div className="vr-eye vr-eye-right" aria-hidden="true"><div className="vr-eye-surface"><div className="scene-main"><SceneViewport eye="right" /></div>{dashboardSurface("right")}</div></div></div> : <div className="normal-stage"><div className="scene-main"><SceneViewport eye="normal" onPartClick={handleScenePartClick} /></div>{dashboardSurface("normal")}</div>}
  </div>;
}
