import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Database,
  History,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  approveSkillScript,
  deleteMemory,
  memoryAction,
  memoryHistory,
  mergeAction,
  readMemorySnapshot,
  restoreMemoryBackup,
  saveMemory,
  scheduleMemoryMaintenance,
  type MemoryBackup,
  type MemorySnapshot,
} from "@/lib/memory";

type Tab = "memory" | "skills" | "approvals";

export function MemoryPanel({
  projectId,
  projectCwd,
}: {
  projectId: string;
  projectCwd: string;
}) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("memory");
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", body: "", tags: "", pinned: false });
  const [backups, setBackups] = useState<MemoryBackup[]>([]);
  const [deletedBackup, setDeletedBackup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    if (!projectId) return;
    setBusy(true);
    setError("");
    try {
      setSnapshot(await readMemorySnapshot(projectId, projectCwd));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Načtení paměti selhalo.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectCwd]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Akce selhala.");
    } finally {
      setBusy(false);
    }
  };

  const filteredMemory = useMemo(() => {
    if (!snapshot) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return snapshot.memory;
    return snapshot.memory.filter((item) =>
      `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(needle),
    );
  }, [snapshot, query]);

  const selected = snapshot?.memory.find((item) => item.path === selectedPath);
  const lastConsolidation = snapshot?.stats.lastConsolidation ?? null;

  const loadBackups = async (relPath: string) => {
    try {
      setBackups(await memoryHistory(relPath, projectId, projectCwd));
    } catch {
      setBackups([]);
    }
  };

  const selectItem = (item: MemorySnapshot["memory"][number]) => {
    setSelectedPath(item.path);
    setDeletedBackup(null);
    setEditing(false);
    void loadBackups(item.path);
    setForm({
      name: item.name,
      description: item.description,
      body: item.body,
      tags: item.tags.join(", "),
      pinned: item.pinned,
    });
  };

  const saveEdit = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const path = await saveMemory(
        {
          path: selected.path,
          name: form.name,
          description: form.description,
          body: form.body,
          scope: selected.scope,
          scopeOwner: selected.scopeOwner,
          pinned: form.pinned,
          tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        },
        projectId,
        projectCwd,
      );
      setSelectedPath(path);
      setEditing(false);
      setMessage("Záznam je uložený.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Uložení selhalo.");
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    if (!selected) return;
    if (!window.confirm(`Smazat záznam „${selected.name}“?`)) return;
    setBusy(true);
    setError("");
    try {
      const result = await deleteMemory(selected.path, projectId, projectCwd);
      setDeletedBackup(result.backup ?? null);
      setSelectedPath(null);
      setBackups([]);
      setEditing(false);
      setMessage(result.backup ? "Záznam je smazaný; zálohu můžeš vrátit." : "Záznam je smazaný.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Smazání selhalo.");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (backup: string, target?: string) => {
    setBusy(true);
    setError("");
    try {
      const path = await restoreMemoryBackup(backup, target, projectId, projectCwd);
      setSelectedPath(path);
      setDeletedBackup(null);
      setMessage("Záloha je obnovená.");
      await load();
      await loadBackups(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Obnovení selhalo.");
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) {
    return <div className="memory-empty">Vyber projekt. Paměť je viditelná pro jeho scope.</div>;
  }

  return (
    <div className="memory-panel" onClick={(event) => event.stopPropagation()}>
      <div className="memory-toolbar">
        <div className="memory-stats">
          <span><Database size={13} /> {snapshot?.stats.memory ?? "—"} záznamů</span>
          <span>{snapshot?.stats.episodes ?? "—"} epizod</span>
          <span className={lastConsolidation ? "" : "muted"}>
            {lastConsolidation
              ? `údržba ${new Date(lastConsolidation).toLocaleString("cs-CZ")}`
              : "údržba zatím neproběhla"}
          </span>
        </div>
        <div className="memory-actions">
          <button className="tool-button" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={13} /> Obnovit
          </button>
          <button
            className="tool-button"
            disabled={busy}
            onClick={() => void run(() => memoryAction("rebuild", undefined, projectId, projectCwd))}
          >
            <Wrench size={13} /> Přestavět index
          </button>
          <button
            className="tool-button"
            disabled={busy}
            onClick={() => void run(scheduleMemoryMaintenance)}
          >
            <ShieldCheck size={13} /> Naplánovat údržbu
          </button>
        </div>
      </div>

      <div className="segmented memory-tabs">
        <button className={tab === "memory" ? "active" : ""} onClick={() => setTab("memory")}>
          Paměť
        </button>
        <button className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>
          Skilly <span className="count-badge">{snapshot?.skills.length ?? 0}</span>
        </button>
        <button className={tab === "approvals" ? "active" : ""} onClick={() => setTab("approvals")}>
          Schválení{" "}
          <span className="count-badge">
            {(snapshot?.approvals.skills.length ?? 0) +
              (snapshot?.approvals.scripts.length ?? 0) +
              (snapshot?.approvals.merges.length ?? 0)}
          </span>
        </button>
      </div>

      {error && <div className="memory-alert error"><AlertTriangle size={14} /> {error}</div>}
      {message && <div className="memory-alert ok"><Check size={14} /> {message}</div>}
      {deletedBackup && (
        <div className="memory-alert ok">
          <RotateCcw size={14} /> Smazaný záznam má zálohu.
          <button className="tool-button" disabled={busy} onClick={() => void restore(deletedBackup)}>
            Vrátit smazání
          </button>
        </div>
      )}

      {tab === "memory" && (
        <div className="memory-columns">
          <div className="memory-list">
            <label className="memory-search">
              <Search size={13} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Hledat v paměti…"
              />
            </label>
            {busy && !snapshot && <div className="memory-empty">Načítám…</div>}
            {!busy && filteredMemory.length === 0 && (
              <div className="memory-empty">Zatím tu není žádný záznam.</div>
            )}
            {filteredMemory.map((item) => (
              <button
                key={item.path}
                className={`memory-item ${selectedPath === item.path ? "selected" : ""}`}
                onClick={() => selectItem(item)}
              >
                <span className="memory-item-title">
                  {item.pinned ? "★ " : ""}
                  {item.name}
                </span>
                <small>{item.description}</small>
                <span className="memory-meta">
                  {item.scope}
                  {item.scopeOwner ? `:${item.scopeOwner}` : ""} · {item.tags.join(", ") || "bez tagů"}
                </span>
              </button>
            ))}
          </div>
          <div className="memory-detail">
            {selected ? editing ? (
              <div className="memory-edit">
                <label>
                  Název
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </label>
                <label>
                  Popis
                  <input
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                  />
                </label>
                <label>
                  Tělo
                  <textarea
                    value={form.body}
                    rows={8}
                    onChange={(event) => setForm({ ...form, body: event.target.value })}
                  />
                </label>
                <label>
                  Tagy (čárkami)
                  <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
                </label>
                <label className="memory-check">
                  <input
                    type="checkbox"
                    checked={form.pinned}
                    onChange={(event) => setForm({ ...form, pinned: event.target.checked })}
                  />
                  Pinned (vždy v kontextu)
                </label>
                <div className="memory-detail-actions">
                  <button className="primary-button" disabled={busy} onClick={() => void saveEdit()}>
                    <Save size={13} /> Uložit
                  </button>
                  <button className="tool-button" disabled={busy} onClick={() => setEditing(false)}>
                    Zrušit
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="memory-detail-head">
                  <div>
                    <strong>{selected.name}</strong>
                    <small>{selected.path} · {new Date(selected.updated).toLocaleString("cs-CZ")}</small>
                  </div>
                  <div className="memory-detail-actions">
                    <button className="tool-button" disabled={busy} onClick={() => setEditing(true)}>
                      <Pencil size={13} /> Upravit
                    </button>
                    <button className="tool-button danger" disabled={busy} onClick={() => void removeSelected()}>
                      <Trash2 size={13} /> Smazat
                    </button>
                  </div>
                </div>
                <p>{selected.description}</p>
                <pre>{selected.body || "(bez těla)"}</pre>
                {backups.length > 0 && (
                  <div className="memory-history">
                    <div className="memory-history-title"><History size={13} /> Historie ({backups.length})</div>
                    {backups.slice(0, 5).map((entry) => (
                      <div className="memory-history-row" key={entry.backup}>
                        <small>{new Date(entry.createdAt).toLocaleString("cs-CZ")}</small>
                        <button
                          className="tool-button"
                          disabled={busy}
                          onClick={() => void restore(entry.backup, entry.path)}
                        >
                          <RotateCcw size={12} /> Obnovit
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="memory-empty">Vyber záznam pro detail.</div>
            )}
          </div>
        </div>
      )}

      {tab === "skills" && (
        <div className="memory-list">
          {(snapshot?.skills.length ?? 0) === 0 && (
            <div className="memory-empty">Žádné skilly.</div>
          )}
          {snapshot?.skills.map((skill) => (
            <div className="skill-row" key={skill.name}>
              <div className="skill-row-main">
                <strong>
                  {skill.name} <span className={`status-badge ${skill.status}`}>{skill.status}</span>
                </strong>
                <small>{skill.description}</small>
                <span className="memory-meta">
                  {skill.stats.uses} použití · {skill.stats.successes} úspěchů ·{" "}
                  {skill.stats.failures} selhání · v{skill.version}
                </span>
              </div>
              {skill.status === "draft" && (
                <div className="skill-row-actions">
                  <button
                    className="tool-button"
                    disabled={busy}
                    onClick={() => void run(() => memoryAction("approve-skill", skill.name, projectId, projectCwd))}
                  >
                    <Check size={13} /> Schválit
                  </button>
                  <button
                    className="tool-button danger"
                    disabled={busy}
                    onClick={() => void run(() => memoryAction("reject-skill", skill.name, projectId, projectCwd))}
                  >
                    <X size={13} /> Zamítnout
                  </button>
                </div>
              )}
            </div>
          ))}
          {snapshot?.skillErrors.map((failure) => (
            <div className="memory-alert error" key={failure.relPath}>
              <AlertTriangle size={14} /> {failure.relPath}: {failure.message}
            </div>
          ))}
        </div>
      )}

      {tab === "approvals" && (
        <div className="memory-list">
          {(snapshot?.approvals.skills.length ?? 0) === 0 &&
            (snapshot?.approvals.scripts.length ?? 0) === 0 &&
            (snapshot?.approvals.merges.length ?? 0) === 0 && (
              <div className="memory-empty">Nic nečeká na schválení.</div>
            )}
          {snapshot?.approvals.skills.map((skill) => (
            <div className="skill-row" key={skill.name}>
              <div className="skill-row-main">
                <strong>{skill.name} <span className="status-badge draft">draft</span></strong>
                <small>{skill.description}</small>
              </div>
              <div className="skill-row-actions">
                <button
                  className="tool-button"
                  disabled={busy}
                  onClick={() => void run(() => memoryAction("approve-skill", skill.name, projectId, projectCwd))}
                >
                  <Check size={13} /> Schválit
                </button>
                <button
                  className="tool-button danger"
                  disabled={busy}
                  onClick={() => void run(() => memoryAction("reject-skill", skill.name, projectId, projectCwd))}
                >
                  <X size={13} /> Zamítnout
                </button>
              </div>
            </div>
          ))}
          {snapshot?.approvals.merges.map((proposal) => (
            <div className="skill-row merge-row" key={`merge-${proposal.id}`}>
              <div className="skill-row-main">
                <strong>{proposal.mergedName} <span className="status-badge draft">sloučení</span></strong>
                <small>{proposal.mergedDescription}</small>
                <span className="memory-meta">
                  {proposal.paths.join(" + ")}
                  {proposal.reason ? ` · ${proposal.reason}` : ""}
                </span>
                {proposal.mergedBody && <pre className="merge-preview">{proposal.mergedBody}</pre>}
              </div>
              <div className="skill-row-actions">
                <button
                  className="tool-button"
                  disabled={busy}
                  onClick={() => void run(() => mergeAction("approve-merge", proposal.id, projectId, projectCwd))}
                >
                  <Check size={13} /> Sloučit
                </button>
                <button
                  className="tool-button danger"
                  disabled={busy}
                  onClick={() => void run(() => mergeAction("reject-merge", proposal.id, projectId, projectCwd))}
                >
                  <X size={13} /> Zamítnout
                </button>
              </div>
            </div>
          ))}
          {snapshot?.approvals.scripts.map((script) => (
            <div className="skill-row" key={`${script.skill}-${script.path}`}>
              <div className="skill-row-main">
                <strong>{script.skill}/{script.path}</strong>
                <small className="memory-meta">hash {script.hash.slice(0, 16)}…</small>
              </div>
              <button
                className="tool-button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    approveSkillScript(script.skill, script.path, projectId, projectCwd),
                  )
                }
              >
                <ShieldCheck size={13} /> Schválit hash
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
