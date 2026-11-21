# Architektura paměti, skillů a asistenta

Stav: Fáze 1, 2 a 3 jsou implementované v `agent-memory/`, otestované 48 testy a změřené na 5 000 záznamech. Samoučení, asistenta, zálohy, embeddingy a Android vrstvu popisuje `docs/memory-phase2.md`.

## 1. Rozhodnutí

Paměťové jádro běží jako **Node/TypeScript proces v Termuxu**. Není to nativní Java modul, protože:

- `~/.agent` je Termux HOME a proces APK na něj nemá přímý přístup;
- MCP server pro CLI agenty musí běžet v Termuxu;
- Node 24 má `node:sqlite` s FTS5 a na zařízení je změřený;
- nativní modul by nešel v tomto prostředí zbuildit ani otestovat.

APK zůstává tenký klient. Přes Termux bridge volá CLI (`ui`, `approve-skill`, `rebuild`) a WorkManager spouští konsolidaci. Assistant smyčka běží v Node procesu, ne v Java vrstvě.

## 2. Struktura

```
agent-memory/
  src/
    types.ts          typy a výchozí rozpočty
    frontmatter.ts    plochý YAML subset, žádné nested mapy
    paths.ts          ~/.agent, scope cesty, ochrana proti traversal
    store.ts          atomický zápis markdownu, přejmenování, mazání
    backups.ts        záloha před přepisem/smazáním, historie a obnova
    db.ts             SQLite schéma, migrace, FTS5, hash sync, embeddingy
    embeddings.ts     dávkové embeddingy, vektorové a hybridní hledání
    merges.ts         návrhy sloučení podobných záznamů a jejich schválení
    retrieval.ts      bezpečný FTS dotaz, ranking, rozpočet kontextu
    extract.ts        validace kandidátů, dedup, filtr tajemství
    skills.ts         SKILL.md, router, statistiky, schválení skriptů
    adapters/         fake, Gemini extrakce a Gemini chat
    assistant/        smyčka, session, tools, approvals, process runner
    script-runner.ts  spouštění hash-approved skriptů
    curator.ts        povýšení starých epizod na fakta
    mcp.ts            stdio JSON-RPC server
    cli.ts            sync/search/context/remember/skills/route/chat/ui/approve/mcp
```

`agent-memory` neimportuje React, Capacitor ani server. Runtime závislosti jsou jen Node built-in moduly.

## 3. Úložiště

```
~/.agent/
  memory/
    global/<slug>.md
    projects/<project-id>/<slug>.md
    agents/<agent-id>/<slug>.md
  skills/<slug>/SKILL.md
  backups/memory/<timestamp>/<původní cesta>.md
  index.db
```

Markdown je zdroj pravdy. `index.db` je odvozený a smí se kdykoli smazat; `sync` ho postaví znovu. Každý soubor má hash; sync přeindexuje jen změněné a smaže chybějící.

Před každým přepsáním nebo smazáním se existující soubor zkopíruje do `backups/memory/<timestamp>/`. Historie se čte přes `memory-history`, obnova přes `memory-restore`; zálohy se needitují a do indexu se nepočítají.

Frontmatter je plochý: `name`, `description`, `scope`, `scope_owner`, `source`, `confidence`, `pinned`, `tags`, `created`, `updated`.

## 4. Scope a viditelnost

- `global` — vždy viditelné.
- `project` — jen pro aktuální `projectId`.
- `agent` — jen pro aktuální `agentId`.

Cizí projekt se do výsledků nedostane, i když má stejná slova. Přiřazení dělá vrstva aplikace, ne model.

## 5. Zápis

1. Model (Gemini) dostane jednu zprávu a vrátí JSON kandidáty.
2. Deterministická vrstva zkontroluje schéma, délky, scope a confidence.
3. Zahodí `durability: "ephemeral"`.
4. Zahodí možná tajemství (privátní klíče, `AIza…`, `ghp_…`, `sk-…`, `xox…`, `password = …`).
5. Zahodí duplikáty podle názvu a popisu.
6. Teprve pak zapíše markdown a index.

Model nikdy nezapisuje soubory přímo. `memory_write` z MCP prochází stejnou validací jako automatická extrakce.

## 6. Čtení

`buildContext()` vezme uživatelskou zprávu, vytvoří prefixový FTS dotaz, načte kandidáty, přidá váhu scope, pinned a stáří, odstraní duplicity a ořeže výstup na rozpočet:

- max. 5 záznamů,
- max. 3 600 znaků celkem,
- max. 1 200 znaků pro pinned část.

Výstup je jen seznam faktů, ne instrukce. Vložený text z paměti nesmí měnit systémový prompt.

Volitelně lze zapnout sémantické hledání. `embed` doplní chybějící vektory přes Gemini `batchEmbedContents`; vektory jsou float32 BLOB v `memory_embeddings` a nesou název modelu i dimenzi, takže změna modelu staré vektory invaliduje. `search --semantic` a `context --semantic` kombinují vektorové skóre s FTS; bez klíče nebo při chybě API se vrací čistě FTS výsledek.

## 7. Skilly

`SKILL.md` má plochý frontmatter (`name`, `description`, `triggers`, `allowed-tools`, `permissions`, `version`, `status`) a tělo s postupem. Stavy jsou `draft`, `probation`, `active` a `disabled`; router vidí jen `probation` a `active`.

Skript se nesmí spustit, pokud:

- manifest nemá `run-scripts` nebo `execute`;
- aktuální hash souboru nemá záznam v `skill_approvals`.

Změna skriptu hash změní a schválení tím propadne. `runSkillScript()` vybírá interpret podle přípony, spouští bez shellu, s malým prostředím, timeoutem a limitem výstupu.

## 8. MCP nástroje

- `memory_search`
- `memory_read`
- `memory_write`
- `skill_list`
- `skill_load`
- `skill_propose`

Server mluví JSON-RPC 2.0 po stdio, podporuje `initialize`, `ping`, `tools/list` a `tools/call`. Chyby vrací jako JSON-RPC error, nikdy nezhavaruje na neplatném vstupu.

## 9. Měření

Naměřeno v Termuxu, Node 24.18, 5 000 markdown záznamů, file-backed SQLite:

| Metrika | Hodnota |
|---|---|
| Průměr `buildContext` | 9,75 ms |
| p95 | 16,78 ms |
| maximum | 17,85 ms |
| Průměrná velikost kontextu | 335 znaků |
| Plný sync 5 000 souborů | 8,5 s |

Limit 20 ms je splněn pro samotný index a retrieval. IPC přes Termux bridge se do měření nepočítá; persistentní MCP proces se mu vyhýbá.

## 10. Epizody a samoučení

Úspěšné kroky se logují do `episodes` (+ FTS5). Detektor hledá opakované sekvence nástrojů ve třech relacích nebo dlouhou úspěšnou relaci a vytváří `draft` skill. Tělo draftu obsahuje jen názvy nástrojů a počty, nikdy volný text logů. Draft se musí schválit; `probation` se po třech úspěších povýší a po třech selháních vypne.

Konsolidace se odmítne spustit bez `idle` a `charging`, synchronizuje index, zkontroluje integritu a maže epizody po 30 dnech. Volitelný curator nejprve vytěží trvalá fakta; při jeho chybě se surové epizody nesmažou.

## 11. Asistent

`runAssistant()` používá jediný adaptér `ChatModelAdapter`. Gemini adaptér překládá neutrální tool schéma na function calling a podporuje fallback modely přes `GEMINI_MODELS`. Stav relace je v SQLite (`assistant_sessions`, `assistant_messages`), takže výměna modelu nezávisí na historii poskytovatele.

Rizikové nástroje jdou přes `ApprovalGate`; aplikace zobrazí skutečné argumenty. Výstupy nástrojů jsou vždy označené jako nedůvěryhodná data. `write_file` zálohuje před přepsáním, `run_command` má timeout a limit výstupu, skripty vyžadují hash schválení.

Android WorkManager spouští konsolidaci jen při nabíjení, device idle a dostatečné baterii. UI čte snapshot přes `cli.ts ui`.

Dlouhé příkazy z chatu může Android spustit přes `AssistantTaskService` s `foregroundServiceType="dataSync"`. Služba drží wake lock, zobrazí notifikaci a předá Termuxu `PendingIntent`; výsledek se uloží do `cacheDir/assistant-tasks/` a přečte po dokončení. Termux zůstává vlastníkem procesu a výstup se do UI dostane po dokončení, ne po tokenech.

## 12. Slučování a undo

Přesné duplicity (stejné jméno, popis i tělo) se mažou deterministicky při konsolidaci s `--merge-duplicates` a před smazáním se zálohují. Podobné záznamy se stejným jménem, ale jiným tělem vytvářejí pouze `pending` návrh v `memory_merge_proposals`; kurátor navrhne sloučené znění, ale soubory se nezmění, dokud uživatel nezavolá `approve-merge` nebo neklikne v UI. `reject-merge` návrh pouze uzavře.

## 13. Záměrné limity

- Foreground služba není streamovací transport; průběžný výstup zůstává v Termuxu a do aplikace se dostane jako výsledek.
- Automaticky se schvaluje jen přesná duplicita; podobné záznamy vždy čekají na člověka.
- Bez `GEMINI_API_KEY` nejsou embeddingy ani sémantické hledání dostupné; FTS zůstává funkční.
- Android APK nikdy nespouští shell přímo, pouze přes Termux `RUN_COMMAND`.
