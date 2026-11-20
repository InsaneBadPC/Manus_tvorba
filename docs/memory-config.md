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
| `GEMINI_API_KEY` | klíč pro extrakci | žádný |
| `GEMINI_MODEL` | model pro extrakci | `gemini-2.5-flash` |

Klíč se nikdy nepředává jako argument příkazové řádky. Načti ho z trezoru do prostředí:

```bash
export GEMINI_API_KEY=$(secrets get sec-gemini-primary-aq)
```

## Příkazy

Spouštěj z kořene repozitáře:

```bash
node agent-memory/src/cli.ts sync
node agent-memory/src/cli.ts search "gradle release" --limit 5
node agent-memory/src/cli.ts context "jak se staví APK"
node agent-memory/src/cli.ts remember "Používáme pytest a coverage."
node agent-memory/src/cli.ts skills
node agent-memory/src/cli.ts route "spusť testy"
node agent-memory/src/cli.ts approve testing run.sh
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

`context` vypíše blok paměti na stdout a metriky (`chars`, `tokens~`, `ms`) na stderr.

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
