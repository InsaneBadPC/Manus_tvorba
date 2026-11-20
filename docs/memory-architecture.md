# Architektura paměti a skillů (Fáze 1)

Stav: implementováno v `agent-memory/`, otestováno 21 testy, změřen výkon na 5 000 záznamech.

## 1. Rozhodnutí

Paměťové jádro běží jako **Node/TypeScript proces v Termuxu**. Není to nativní Java modul, protože:

- `~/.agent` je Termux HOME a proces APK na něj nemá přímý přístup;
- MCP server pro CLI agenty musí běžet v Termuxu;
- Node 24 má `node:sqlite` s FTS5 a na zařízení je změřený;
- nativní modul by nešel v tomto prostředí zbuildit ani otestovat.

APK zůstává tenký klient. Později se k němu přidá bridge nebo krátké Termux volání. Assistant smyčka, foreground service a UI patří do Fáze 2.

## 2. Struktura

```
agent-memory/
  src/
    types.ts          typy a výchozí rozpočty
    frontmatter.ts    plochý YAML subset, žádné nested mapy
    paths.ts          ~/.agent, scope cesty, ochrana proti traversal
    store.ts          atomický zápis markdownu, přejmenování, mazání
    db.ts             SQLite schéma, migrace, FTS5, hash sync
    retrieval.ts      bezpečný FTS dotaz, ranking, rozpočet kontextu
    extract.ts        validace kandidátů, dedup, filtr tajemství
    skills.ts         SKILL.md, router, statistiky, schválení skriptů
    adapters/         fake a Gemini
    mcp.ts            stdio JSON-RPC server
    cli.ts            sync/search/context/remember/skills/route/approve/mcp
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
  index.db
```

Markdown je zdroj pravdy. `index.db` je odvozený a smí se kdykoli smazat; `sync` ho postaví znovu. Každý soubor má hash; sync přeindexuje jen změněné a smaže chybějící.

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

## 7. Skilly

`SKILL.md` má plochý frontmatter (`name`, `description`, `triggers`, `allowed-tools`, `permissions`, `version`, `status`) a tělo s postupem. Router vybírá nejvýše jeden skill podle triggerů a názvu.

Skript se nesmí spustit, pokud:

- manifest nemá `run-scripts` nebo `execute`;
- aktuální hash souboru nemá záznam v `skill_approvals`.

Změna skriptu hash změní a schválení tím propadne. Samotný runner skriptů není součástí Fáze 1; implementované je pouze bezpečnostní hradlo `canRunScript()`.

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

## 10. Co záměrně chybí

- Assistant klient a modelová smyčka — chybí nadřazená vrstva, ne paměť.
- UI pro správu paměti a potvrzovací karty.
- Spouštěč skriptů a foreground service.
- Embeddingy a vektorové hledání.
- Konsolidace na pozadí a exploitní ochrana proti prompt injection v assistantovi (paměť už vkládá jen data, ale nadřazený prompt ještě neexistuje).
