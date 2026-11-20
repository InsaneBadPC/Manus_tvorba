# Fáze 2 — samoučení, schvalování a údržba

Stav: jádro implementováno v `agent-memory/`, 34 testů prochází. UI, Android bridge a assistant smyčka zůstávají dalším krokem.

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

Pole `session` je důležité: bez něj se každá epizoda bere jako samostatná relace, aby z nesouvisejících poznámek nevznikl falešný postup. Syrové epizody se mažou po 30 dnech při konsolidaci; sumarizace přes `curator` zatím není implementovaná.

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

`approvals` vypíše drafty a skripty, jejichž aktuální hash nemá schválení. MCP `skill_propose` nově vytváří `draft`, ne rovnou `probation`; model tedy nemůže sám aktivovat novou instrukci. Skript bez schválení zůstává nespustitelný i po povýšení skillu.

## 5. Konsolidace

```bash
node agent-memory/src/cli.ts consolidate --idle --charging
```

`consolidate()` odmítne běžet, pokud nejsou oba příznaky pravdivé. Android vrstva je musí naplnit skutečným stavem baterie a aktivity, ne Konstantou. Úloha:

1. synchronizuje markdown paměť a skilly,
2. zkontroluje `PRAGMA integrity_check`,
3. smaže epizody starší než `--retention-days` (výchozí 30),
4. vypíše duplicity názvů paměti a stav fronty schválení,
5. zapíše `last_consolidation` do `meta`.

Duplicity se zatím pouze reportují, nemažou. Slučování a povyšování epizod na sémantická fakta patří k `curator` roli, která není hotová.

## 6. Co ještě chybí

- Assistant smyčka, která bude epizody zapisovat automaticky po každém kroku.
- Android foreground service / WorkManager, který zavolá konsolidaci při nabíjení a idle.
- Obrazovka paměti, skillů a fronty schválení.
- `curator` model pro sumarizaci a slučování.
- Spouštěč schválených skriptů; hotové je pouze bezpečnostní hradlo.
