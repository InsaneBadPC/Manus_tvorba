# Konfigurace paměti a MCP

## Požadavky

- Node **24+** (kvůli `node:sqlite` a spouštění TypeScriptu bez buildu).
- Termux s přístupem k `~/.agent`.
- Volitelně `GEMINI_API_KEY` pro automatickou extrakci.

Node 22 `node:sqlite` bez příznaku nenačte; CI je proto nastavené na Node 24.

## Proměnné prostředí

| Proměnná | Význam | Výchozí |
|---|---|---|
| `AGENT_HOME` | kořen paměti a skillů | `~/.agent` |
| `AGENT_PROJECT_ID` | aktuální projekt pro scope a viditelnost | žádný |
| `AGENT_AGENT_ID` | aktuální agent | žádný |
| `GEMINI_API_KEY` | klíč pro extrakci, chat a curator | žádný |
| `GEMINI_MODEL` | model pro extrakci | `gemini-2.5-flash` |
| `GEMINI_MODELS` | chat modely a fallback v pořadí, čárkami | `gemini-2.5-flash` |
| `GEMINI_TIMEOUT_MS` | timeout jednoho chat nebo embedding volání | `60000` |
| `GEMINI_EMBED_MODEL` | model pro embeddingy | `gemini-embedding-001` |
| `GEMINI_EMBED_DIM` | dimenze vektoru (64–3072) | `768` |

Klíč se nikdy nepředává jako argument příkazové řádky. Načti ho z trezoru do prostředí:

```bash
export GEMINI_API_KEY=$(secrets get sec-gemini-primary-aq)
```

## Příkazy

Spouštěj z kořene repozitáře:

```bash
node agent-memory/src/cli.ts sync
node agent-memory/src/cli.ts search "gradle release" --limit 5
node agent-memory/src/cli.ts search "gradle release" --semantic
node agent-memory/src/cli.ts context "jak se staví APK"
node agent-memory/src/cli.ts context "jak se staví APK" --semantic
node agent-memory/src/cli.ts embed
node agent-memory/src/cli.ts embed --force
node agent-memory/src/cli.ts remember "Používáme pytest a coverage."
node agent-memory/src/cli.ts memory-save --project alpha < entry.json
node agent-memory/src/cli.ts memory-delete memory/projects/alpha/stary-zaznam.md --project alpha
node agent-memory/src/cli.ts memory-history memory/projects/alpha/stary-zaznam.md
node agent-memory/src/cli.ts memory-restore backups/memory/2026-11-21T04-00-00-000Z/memory/projects/alpha/stary-zaznam.md
node agent-memory/src/cli.ts propose-merges
node agent-memory/src/cli.ts merges
node agent-memory/src/cli.ts approve-merge 3
node agent-memory/src/cli.ts reject-merge 3
node agent-memory/src/cli.ts skills
node agent-memory/src/cli.ts route "spusť testy"
node agent-memory/src/cli.ts approve testing run.sh
node agent-memory/src/cli.ts approvals
node agent-memory/src/cli.ts approve-skill postup-terminal-edit-test
node agent-memory/src/cli.ts reject-skill postup-terminal-edit-test
node agent-memory/src/cli.ts episode "pytest prošel" --kind result --session run-1 --tools terminal,test
node agent-memory/src/cli.ts episodes --limit 20
node agent-memory/src/cli.ts detect --dry-run
node agent-memory/src/cli.ts outcome testing --failure
node agent-memory/src/cli.ts consolidate --idle --charging --retention-days 30
node agent-memory/src/cli.ts consolidate --idle --charging --curator --merge-duplicates
node agent-memory/src/cli.ts chat "Zjisti, jak se spouštějí testy, a spusť je"
node agent-memory/src/cli.ts chat "Pokračuj" --session cli --json
node agent-memory/src/cli.ts sessions
node agent-memory/src/cli.ts ui --project alpha
node agent-memory/src/cli.ts rebuild
node agent-memory/src/cli.ts mcp
```

Společné volby:

```bash
--root /cesta/.agent
--project alpha
--agent coder
--all          # search: i cizí scopes (jen pro diagnostiku)
```

`memory-save` čte JSON z stdin. Pro editaci přidej `path`; bez něj se záznam vytvoří nebo aktualizuje podle názvu. Každý přepis i smazání nejdřív zkopíruje soubor do `~/.agent/backups/memory/<timestamp>/`; `memory-history` vypíše zálohy a `memory-restore <záloha>` je vrátí (volitelně s `--path`).

`propose-merges` projde záznamy se stejným jménem a jiným tělem a uloží pouze návrhy. Teprve `approve-merge <id>` zapíše sloučený obsah a odstraní zbylé soubory; každý z nich se předtím zazálohuje. UI používá stejný tok přes `cli.ts ui` a příkazy `approve-merge`/`reject-merge`.

```json
{
  "name": "Testy pytestem",
  "description": "Projekt používá pytest.",
  "body": "pytest -q",
  "scope": "project",
  "pinned": false,
  "tags": ["testy"]
}
```

`context` vypíše blok paměti na stdout a metriky (`chars`, `tokens~`, `ms`) na stderr.

`consolidate` bez obou flagů `--idle` a `--charging` selže. Android je předává podle skutečného stavu zařízení; nejde je nahradit konstantou.

`chat` potřebuje `GEMINI_API_KEY`. Bez TTY se rizikové nástroje automaticky zamítnou; `--yes` použij jen v řízeném neinteraktivním běhu. `--json` vrací i tool cally a výsledky.

`embed` a `--semantic` také potřebují `GEMINI_API_KEY`. `embed` doplní jen chybějící vektory pro aktuální model a dimenzi; `--force` je přepočítá. Při změně `GEMINI_EMBED_MODEL` nebo `GEMINI_EMBED_DIM` se staré vektory nepoužijí a je potřeba znovu spustit `embed`.

`ui` vrací JSON snapshot paměti, skillů, schválení, relací a metrik pro Android obrazovku.

## Chat modely a fallback

Chat adaptér bere seznam z `GEMINI_MODELS`; první model je primární, další se zkusí při 429, 5xx, timeoutu nebo chybě sítě. Extrakce a curator používají `GEMINI_MODEL`. Vše model-specifické zůstává v `src/adapters/`, smyčka je na modelu nezávislá.

```bash
export GEMINI_MODELS="gemini-2.5-flash,gemini-2.0-flash"
```

## Android údržba

WorkManager plánuje `MemoryMaintenanceWorker` s constraints `charging`, `device idle` a `battery not low`. Worker znovu zkontroluje nabíjení a vypnutý displej, najde `agent-memory/src/cli.ts` a spustí `consolidate --idle --charging`. Pokud je v Termuxu klíč, přidá `--curator` a `--propose-merges`.

Dlouhé chatové příkazy lze v UI přepnout na „Na pozadí“. `AssistantTaskService` typu `dataSync` drží wake lock a notifikaci, spustí příkaz přes Termux a výsledek uloží do `cacheDir/assistant-tasks/<taskId>.log`. Android 13+ si vyžádá `POST_NOTIFICATIONS`; bez povolení služba běží, ale notifikace nemusí být vidět.

## MCP v Claude Code / jiném klientovi

Příklad `mcpServers` (uprav absolutní cestu):

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": [
        "/data/data/com.termux/files/home/InsaneCode/Manus_tvorba/agent-memory/src/cli.ts",
        "mcp"
      ],
      "env": {
        "AGENT_HOME": "/data/data/com.termux/files/home/.agent",
        "AGENT_PROJECT_ID": "manus_tvorba",
        "AGENT_AGENT_ID": "claude"
      }
    }
  }
}
```

Server nepotřebuje `npm install`; běží na Node built-in modulech. Při startu provede sync, takže první odpověď může trvat podle počtu souborů.

## Rozpočty

V `agent-memory/src/types.ts`:

```ts
DEFAULT_BUDGET = {
  maxRecords: 5,
  maxChars: 3600,
  coreMaxChars: 1200,
}
```

`maxChars / 4` je konzervativní odhad tokenů. Pro jiný model uprav `buildContext` nebo předej `budget` z volajícího kódu.

## Oprávnění a zálohy

- Soubory paměti se zapisují s mode `0600`.
- `~/.agent` obsahuje osobní data; nezahrnuj ho do gitu.
- Zálohu stačí dělat z markdown souborů a `skills/`; `index.db` lze zahodit.
- `rebuild` smaže `index.db`, `-wal` a `-shm` a znovu je postaví.

## Řešení potíží

| Problém | Příčina / řešení |
|---|---|
| `Cannot find module 'node:sqlite'` | Node je starší než 24, nebo běží bez potřebného příznaku. |
| `no such module: fts5` | SQLite bez FTS5; použij Node 24 z Termuxu. |
| `frontmatter is missing the closing '---'` | Soubor nemá ukončený frontmatter; přeskočí se a objeví se v `errors`. |
| `duplicate frontmatter key` | Stejný klíč je v souboru dvakrát. |
| `possible secret` | Zápis obsahuje vzor klíče nebo hesla; odstraň hodnotu. |
| `requires an owner id` | Project/agent záznam potřebuje `AGENT_PROJECT_ID` nebo `AGENT_AGENT_ID`. |
| Prázdné výsledky | Zkontroluj `sync`, scope a jestli dotaz není jen stopword. |
