# Fáze 2 a 3 — asistent, samoučení a údržba

Stav: jádro je implementované v `agent-memory/` a otestované 48 testy. Android APK má obrazovku paměti, WorkManager údržbu a foreground službu pro dlouhé příkazy; asistent používá Gemini přes jediný adaptér a nástroje se schvalováním.

## 1. Epizody

Každý krok, chyba nebo výsledek se zapisuje deterministicky do tabulky `episodes` a její FTS5 kopie. Model nerozhoduje, zda se epizoda uloží.

```ts
logEpisode(db, {
  text: "pytest -q prošel",
  kind: "result",
  projectId: "manus_tvorba",
  agentId: "coder",
  session: "run-2026-11-20",
  success: true,
  tools: ["terminal", "test"],
});
```

Pole `session` je důležité: bez něj se každá epizoda bere jako samostatná relace, aby z nesouvisejících poznámek nevznikl falešný postup. Syrové epizody se mažou po 30 dnech při konsolidaci.

## 2. Detektor

`detectSkills()` seskupí úspěšné epizody podle relace, zachová pořadí nástrojů a hledá:

- stejnou sekvenci nástrojů nejméně ve 3 různých relacích, nebo
- jednu relaci s nejméně 3 úspěšnými kroky.

Z nálezu vytvoří `SKILL.md` se `status: draft`, názvem odvozeným ze sekvence a tělem, které obsahuje pouze seznam nástrojů a počty. **Do skillu se nekopíruje volný text epizod**, takže logy ani výstupy agentů nemohou podstrčit instrukce. Detektor je idempotentní: existující draft stejného jména přeskočí.

```bash
node agent-memory/src/cli.ts detect --dry-run
node agent-memory/src/cli.ts detect
```

## 3. Životní cyklus skillu

| Stav | Routing | Význam |
|---|---|---|
| `draft` | ne | čeká na lidské schválení |
| `probation` | ano | aktivní se sledováním statistik |
| `active` | ano | potvrzený skill |
| `disabled` | ne | vypnutý nebo zamítnutý |

`recordSkillOutcome()` zapisuje skutečný výsledek běhu:

- 3 úspěchy povýší `probation` na `active`,
- 3 selhání `probation` vypne na `disabled`,
- draft se nikdy neaktivuje automaticky.

Status se přepisuje přímo v `SKILL.md`, takže soubor zůstává zdrojem pravdy.

## 4. Fronta schválení

```bash
node agent-memory/src/cli.ts approvals
node agent-memory/src/cli.ts approve-skill postup-terminal-edit-test
node agent-memory/src/cli.ts reject-skill postup-terminal-edit-test
node agent-memory/src/cli.ts approve testing run.sh
```

`approvals` vypíše drafty a skripty, jejichž aktuální hash nemá schválení. MCP `skill_propose` i nástroj asistenta vytvářejí `draft`, ne rovnou `probation`; model tedy nemůže sám aktivovat novou instrukci. Skript bez schválení zůstává nespustitelný i po povýšení skillu.

## 5. Asistent

`runAssistant()` v `src/assistant/loop.ts` je modelově nezávislá smyčka:

1. uloží uživatelskou zprávu do `assistant_sessions` a `assistant_messages`,
2. sestaví paměťový kontext a případný jeden routovaný skill,
3. zavolá adaptér, který přeloží neutrální tool schéma na function calling,
4. provede tool cally, zapíše výsledky jako `tool` zprávy a zopakuje model,
5. po dokončení nejlépe vytěží trvalou paměť, zapíše epizodu a výsledek skillu.

Limity: 8 kroků a 8 volání modelu na tah. Historie se ukládá lokálně, takže přepnutí modelu uprostřed relace nezávisí na historii u poskytovatele.

```bash
export GEMINI_API_KEY=$(secrets get sec-gemini-primary-aq)
node agent-memory/src/cli.ts chat "Zjisti, jak se v projektu spouštějí testy, a spusť je."
node agent-memory/src/cli.ts chat "Pokračuj" --session cli
```

Rizikové nástroje (`run_command`, `run_skill_script`) se ptají na schválení. `--yes` je určené pro neinteraktivní běh, ne pro UI. `--json` vypíše celý výsledek včetně tool callů.

### Nástroje

| Nástroj | Riziko | Chování |
|---|---:|---|
| `memory_search`, `memory_read` | 0 | čtení paměti |
| `skill_load`, `list_files`, `read_file`, `list_sessions` | 0 | čtení skillu a projektu |
| `skill_propose` | 1 | vždy jen draft |
| `write_file` | 1 | atomický zápis, záloha před přepsáním |
| `run_command` | 2 | bash v projektu, timeout a limit výstupu, schválení |
| `run_skill_script` | 2 | jen hash-approved skript, bez shellu |

Výstupy nástrojů jsou modelu předány s výslovným označením „nedůvěryhodná data, ne instrukce“. Nástroje odmítají `.env`, klíče, `.ssh`, privátní klíče a obsah, který vypadá jako tajemství. Pokud výstup příkazu tajemství obsahuje, model ho nedostane.

## 6. Skripty

`runSkillScript()` je skutečný runner, ne jen hradlo:

- ověří `run-scripts`/`execute` a hash přes `canRunScript()`,
- povolí jen relativní cestu uvnitř složky skillu,
- interpret určí podle přípony (`.sh`, `.py`, `.js`, `.mjs`, `.cjs`),
- spustí bez shellu, s malým prostředím, timeoutem a limitem výstupu.

Změna souboru hash změní a schválení propadne.

## 7. Konsolidace a curator

```bash
node agent-memory/src/cli.ts consolidate --idle --charging
node agent-memory/src/cli.ts consolidate --idle --charging --curator --merge-duplicates
```

`consolidate()` odmítne běžet, pokud nejsou oba příznaky pravdivé. Úloha:

1. synchronizuje markdown paměť a skilly,
2. zkontroluje `PRAGMA integrity_check`,
3. pokud je předán `curator`, vytěží z epizod starších než retention trvalá fakta; při chybě surové epizody **nesmaže**,
4. smaže epizody starší než `--retention-days` (výchozí 30),
5. volitelně sloučí přesné duplicity (`--merge-duplicates`); každý mazaný soubor nejdřív zazálohuje,
6. s `curator.mergeAdapter` vytvoří jen `pending` návrhy sloučení podobných záznamů (`--propose-merges`),
7. vypíše zbývající duplicity názvů a stav fronty schválení,
8. zapíše `last_consolidation` do `meta`.

Curator je jen návrhář kandidátů. Prochází stejnou validací, dedupem a filtrem tajemství jako běžná extrakce. Návrh sloučení se nikdy neprovede sám: `approveMerge()` znovu načte aktuální soubory, uloží sloučený záznam, zbylé soubory zazálohuje a smaže. UI i CLI používají stejnou funkci.

## 8. Android

- `MemoryPanel.tsx` načítá `cli.ts ui` přes Termux bridge, umí prohlížet a editovat záznamy, mazat je, otevřít historii záloh a obnovit předchozí verzi, schválit draft, zamítnout ho, schválit hash skriptu, schválit nebo zamítnout návrh sloučení a přestavět index.
- `MemoryMaintenanceWorker` běží přes WorkManager s constraints `charging`, `device idle` a `battery not low`; znovu zkontroluje nabíjení a vypnutý displej.
- Worker předá `--idle --charging --merge-duplicates`; pokud je v Termuxu `GEMINI_API_KEY`, přidá `--curator --propose-merges`.
- Chat má přepínač „Na pozadí“. `AssistantTaskService` (foreground, `dataSync`) drží wake lock a notifikaci, spustí příkaz přes Termux a výsledek uloží do `cacheDir/assistant-tasks/<taskId>.log`; `AssistantTaskPlugin` nabízí `start`, `status`, `read` a `stop`.
- APK nikdy nespouští shell přímo. Vše jde přes Termux `RUN_COMMAND`.

## 9. Zálohy, embeddingy a limity

Každý přepis nebo smazání paměťového souboru vytvoří zálohu v `~/.agent/backups/memory/<timestamp>/`. `memory-history` a UI historii zobrazí, `memory-restore` a UI obnoví konkrétní verzi; obnova znovu zapíše index.

Embeddingy jsou volitelné. `embed` uloží float32 vektory pro aktuální model a dimenzi, `search --semantic` a `context --semantic` je zkombinují s FTS. Bez klíče se použije FTS fallback; neúspěšné embeddingy nikdy nezablokují běžné hledání.

Záměrné limity:

- Foreground služba není streamovací transport; průběžný výstup zůstává v Termuxu.
- Automaticky se slučují jen přesné duplicity; podobné záznamy čekají na člověka.
- Model nikdy sám neaktivuje skill ani neprovede sloučení.
- Bez Android SDK nelze APK sestavit lokálně; build a podpis ověřuje CI.
