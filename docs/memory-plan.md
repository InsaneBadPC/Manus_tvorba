# Fáze 0 — plán: paměť, skilly a MCP

Navazuje na `docs/memory-recon.md` a na zadání v `agent-prompt-memory-skills.md` a `specifikace-asistenta.md`.

## 1. Architektonické rozhodnutí

Fáze 1 poběží jako **samostatný Node/TypeScript balíček spouštěný v Termuxu**, ne jako nativní Java/Kotlin modul.

Důvody:

- `~/.agent` je Termux HOME, kam se proces APK nedostane; jediná cesta je `RUN_COMMAND`.
- MCP server pro CLI agenty musí stejně běžet v Termuxu.
- `node:sqlite` s FTS5 je na zařízení ověřené (8,2 ms na dotaz nad 5 000 záznamů).
- Nativní modul nelze v tomto prostředí zbuildit ani otestovat (chybí Android SDK), takže by vznikl neověřený kód.

APK zůstává tenký klient. UI bude později volat službu přes nový bridge nebo přes krátké Termux příkazy. Nativní foreground service se přidá až pro assistant smyčku, ne pro paměť.

Formát zůstává kompatibilní se zadáním: markdown + frontmatter, `SKILL.md`, SQLite jako odvozený index.

## 2. Cílová struktura

```
agent-memory/
  package.json
  tsconfig.json
  src/
    types.ts            # MemoryItem, Episode, Skill, Scope, rozpočty
    frontmatter.ts      # parse/serialize YAML frontmatteru bez těžké závislosti
    paths.ts            # ~/.agent, scope -> cesta, sanitizace názvů
    store.ts            # atomický zápis markdownu, přesun, mazání, hash
    db.ts               # schema, migrace, FTS5, sync podle hashů
    retrieval.ts        # FTS dotaz, BM25 + scope + pinned + recency, budget
    extract.ts          # validace, dedup, filtr tajemství, zápis kandidátů
    skills.ts           # SKILL.md parse, router, statistiky, probation
    adapters/types.ts   # ModelAdapter (extract/complete), role
    adapters/fake.ts    # deterministický fake pro testy
    adapters/gemini.ts  # až po dodání klíče
    mcp.ts              # stdio JSON-RPC: memory_*, skill_*
    cli.ts              # sync, search, rebuild, mcp
  test/
    frontmatter.test.ts
    store.test.ts
    db.test.ts
    retrieval.test.ts
    extract.test.ts
    skills.test.ts
    mcp.test.ts
```

Knihovna nesmí importovat React ani Capacitor. Jediné runtime závislosti: Node 24 (`node:sqlite`, `node:fs`, `node:crypto`). YAML frontmatter se parsuje úzkým vlastním parserem pro ploché klíče a pole; žádná těžká závislost.

## 3. Datové schéma

`~/.agent/memory/{global,projects/<id>,agents/<id>}/*.md` s frontmatterem:

```yaml
name: pytest-v-projektu
description: Projekt používá pytest
scope: project
source: stated
confidence: 0.95
created: 2026-11-19T22:00:00Z
updated: 2026-11-19T22:00:00Z
pinned: false
tags: [testing, python]
```

`~/.agent/skills/<name>/SKILL.md` s `name`, `description`, `triggers`, `allowed-tools`, `version`, `permissions`, `status`.

SQLite `index.db`:

- `memory_items(id, path, hash, name, description, body, scope, source, confidence, pinned, tags, created, updated)`
- `memory_fts` (FTS5: name, description, body) + triggery
- `episodes(id, project, agent, kind, text, created)` + `episodes_fts`
- `skills(id, path, hash, name, description, triggers, status, permissions, version)`
- `skill_stats(skill_id, uses, successes, failures, last_used)`
- `meta(key, value)` — verze schématu, hash souborů, čas poslední konsolidace

Migrace jsou idempotentní (`PRAGMA user_version`). Smazání `index.db` a `sync` musí vrátit stejná data.

## 4. Pořadí prací

### Krok 1 — kostra a markdown store
- `paths.ts`, `frontmatter.ts`, `store.ts`.
- Atomický zápis (temp file + rename), sanitizace názvů, ochrana proti cestě mimo `~/.agent`.
- Testy: round-trip frontmatteru, diakritika, neplatný YAML, kolize názvů.

### Krok 2 — index a synchronizace
- `db.ts`: schema, FTS5, `PRAGMA user_version`, hash sync (přidání/změna/smazání).
- Testy: smazání `index.db` → `sync` → stejné výsledky; změna souboru → přeindexování; smazání souboru → zmizí z FTS.

### Krok 3 — načítání
- `retrieval.ts`: dotaz z uživatelské zprávy (bez LLM), scope váha `agent > project > global`, pinned, recency, dedup, ořez na tokenový rozpočet.
- Rozpočty z konfigurace: `core ≤ 300`, `records ≤ 600`, `skill cap 1`, `max records 5`.
- Měření: latence < 20 ms na 5 000 záznamech; velikost vloženého kontextu ≤ 900 tokenů (odhad 4 znaky/token, měřit skutečný počet znaků).
- Testy: užší scope vyhraje, pinned vyhraje při stejné relevanci, prázdný dotaz nevloží nic, rozpočet se nepřekročí.

### Krok 4 — zápis a extrakce
- `ModelAdapter.extract()` vrací JSON kandidáty; `fake.ts` pro testy.
- Deterministická vrstva: validace schématem, jeden retry, dedup (hash + FTS podobnost), odmítnutí efemérního obsahu, **filtr tajemství** (API klíče, tokeny, hesla, SSH klíče).
- Testy: neplatný JSON → 0 zápisů; duplikát → 1; tajemství → odmítnuto; platný záznam → markdown + index.

### Krok 5 — skilly
- `skills.ts`: parse `SKILL.md`, router přes FTS nad `name/description/triggers`, vložení max. jednoho skillu, statistiky.
- Skripty: bez `permissions` manifestu a schválení nelze spustit; změna skriptu invaliduje schválení (hash).
- Testy: trigger vybere správný skill, nesouvisející zpráva nevybere žádný, skript bez schválení selže, změna hashe vyžadá nové schválení.

### Krok 6 — MCP server
- `mcp.ts`: stdio JSON-RPC, nástroje `memory_search`, `memory_read`, `memory_write`, `skill_list`, `skill_load`, `skill_propose`.
- `memory_write` pro agenty prochází stejnou validací, dedupem a filtrem tajemství.
- Testy: initialize, tools/list, platné a neplatné volání, zápis tajemství odmítnut.

### Krok 7 — dokumentace a měření
- `docs/memory-architecture.md`, `docs/memory-config.md`, `docs/skills-authoring.md`.
- Závěrečný report s naměřenými hodnotami proti kritériím.

## 5. Co záměrně odkládám

- **Gemini adaptér a live chat** — chybí API klíč. Rozhraní je hotové, implementace přijde po dodání klíče.
- **Nativní foreground service a assistant smyčka** — nemá smysl bez modelového klienta; patří do Fáze 2.
- **UI obrazovka paměti** — nejdřív musí existovat služba a její API; pak se přidá panel.
- **Embeddingy** — až Fáze 3, po naplnění měřitelných cílů Fáze 1.
- **Konsolidace na pozadí** — Fáze 2; vyžaduje WorkManager nebo obdobu a nabíjení/idle.

## 6. Akceptační kritéria Fáze 1

1. Načtení paměti < 20 ms (měřeno na 5 000 záznamech; index bez IPC).
2. Vložený kontext ≤ 900 tokenů na tah (měřeno v znacích, konzervativní odhad).
3. Smazání `index.db` a `sync` obnoví index bez ztráty dat.
4. Unit testy pro dedup, validaci schématu, rozpočty a router prochází.
5. `memory_write` odmítne tajemství a efemérní obsah.
6. Skill se skriptem bez schválení nejde spustit.
7. MCP server odpovídá na `initialize` a `tools/list` a umí všechna uvedená volání.

## 7. Otevřená rozhodnutí

1. **Runtime paměti:** Termux Node balíček (doporučeno) vs. nativní Java modul. Bez potvrzení pokračuji Termuxem, protože jinak nelze `~/.agent` obsloužit.
2. **Gemini klíč:** bez něj zůstane adaptér za fake modelem; live extrakce se netestuje.
3. **Přístup UI:** nový Capacitor plugin `AgentMemoryPlugin` (rychlé, typované) vs. shell volání `node .../cli.js` (bez nativní změny). Pro Fázi 1 stačí CLI/MCP; UI přijde potom.
4. **Umístění projektu:** globální paměť a skilly v `~/.agent`; projektové záznamy odkazují na ID projektu, ne na jeho cestu, aby přežily přesun složky.
