# Jak psát skilly

Skill je složka v `~/.agent/skills/<slug>/` s souborem `SKILL.md`. Nic se neinstaluje automaticky z internetu.

## Formát

```markdown
---
name: testing
description: Spouští testy projektu a čte výsledky
triggers: ["testy", "pytest", "unit testy"]
allowed-tools: ["read_file", "run_command"]
permissions: ["run-scripts"]
version: "1.0.0"
status: "active"
---
# Postup

1. Zjisti, jaký test runner projekt používá.
2. Spusť nejmenší relevantní sadu.
3. Přečti selhání a oprav příčinu, ne test.
```

Pravidla frontmatteru:

- ploché klíče, žádné vnořené mapy;
- `name` a `description` jsou povinné;
- `triggers` jsou slova nebo krátké fráze, které router hledá ve zprávě;
- `allowed-tools` je deklarativní seznam, ne automatické povolení;
- `permissions` může obsahovat `run-scripts` nebo `execute`;
- `status` je `draft`, `probation`, `active` nebo `disabled`; `draft` se neroutuje.

Tělo jsou instrukce pro model. Piš je jako postup, ne jako esej. Nevkládej do nich tajemství.

## Routing

Router vybere nejvýše jeden skill. Skóruje:

- přesnou frázi z `triggers` ve zprávě +3,
- částečnou shodu triggeru +1,5,
- shodu názvu +1,
- shodu popisu +0,3.

Práh je 1,5. Když zpráva nesouvisí, nevybere se nic. Nikdy se nevkládají všechny skilly najednou.

Vyzkoušej:

```bash
node agent-memory/src/cli.ts route "spusť pytest"
node agent-memory/src/cli.ts skills
```

## Skripty a schválení

Skript se nesmí spustit, dokud platí obojí:

1. manifest obsahuje `run-scripts` nebo `execute`;
2. hash konkrétního souboru je schválený.

Schválení:

```bash
node agent-memory/src/cli.ts approve testing run.sh
```

Schválení je vázané na hash. Jakákoli změna skriptu ho zneplatní a je potřeba ho znovu schválit. To je záměr: agent nesmí potichu vyměnit schválený skript za jiný.

Samotný runner skriptů zatím není implementovaný. `canRunScript()` je hradlo, které musí budoucí runner volat před každým spuštěním. Fronta neschválených skriptů je v `approvals`.

## Návrh nového skillu

Přes MCP:

```json
{
  "name": "skill_propose",
  "arguments": {
    "name": "release-check",
    "description": "Ověří podpis a verzi APK před vydáním",
    "triggers": ["release", "podpis APK"],
    "body": "1. Ověř fingerprint...\n2. Porovnej latest.json...",
    "permissions": []
  }
}
```

Návrh z MCP se uloží se `status: draft` a `version: 0.1.0`. Draft se neroutuje a nespouští. Po kontrole ho schval příkazem `approve-skill`; tím se dostane na `probation` a začnou se sbírat statistiky. Tři úspěchy ho povýší na `active`, tři selhání vypnou.

## Bezpečnost

- Skill je nedůvěryhodný text, dokud ho člověk neschválí.
- Nevkládej do skillu klíče, tokeny ani hesla.
- `permissions` omezuj na minimum; výchozí je žádné spouštění.
- Skripty musí být uvnitř složky skillu; cesty mimo ni `canRunScript()` odmítne.
- Změna skriptu vždy vyžaduje nové schválení.
