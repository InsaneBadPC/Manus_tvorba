# ÚKOL: Postav systém víceúrovňové paměti a skillů

Jsi autonomní vývojový agent. Postav kompletní systém paměti a dovedností (skillů) do existující aplikace popsané níže. Pracuj samostatně, po fázích, s testy. Ptej se jen tehdy, když tě blokuje rozhodnutí, které nejde rozumně odvodit z kódu; jinak rozhodni, zapiš důvod a pokračuj.

## 1. Kontext

- Aplikace je vývojové prostředí pro Android: AI agenti běží jako CLI v Termuxu, součástí je správce souborů a další nástroje.
- V aplikaci je integrovaný AI asistent, který může ovládat celou aplikaci i agenty.
- Asistent volá **Gemini přes API**; modely se mohou střídat (Flash/Pro/jiné, případně i jiný poskytovatel).
- Uživatel pracuje česky; texty UI, dokumentace a komentáře k záměru piš česky, identifikátory v kódu anglicky.

## 2. Tvrdé požadavky

1. **Plně automatické:** model nerozhoduje, kdy si co pamatovat. Načítání i zápis řídí aplikace deterministicky.
2. **Minimální zátěž kontextu modelu:** typicky ≤ ~900 tokenů navíc na tah; skill jen když sedí.
3. **Minimální zátěž zařízení:** žádné těžké procesy na popředí; konsolidace jen při nabíjení + idle; v MVP bez embeddingů (jen SQLite FTS5).
4. **Rychlé:** načtení paměti před voláním modelu < 20 ms na běžném telefonu.
5. **Nezávislé na modelu:** vše model-specifické je v jediné vrstvě adaptéru a konfiguraci, nikde jinde.
6. **Dlouhodobě udržitelné:** zdroj pravdy jsou čitelné soubory (markdown + frontmatter, verzované v gitu); SQLite je odvozený index, který jde kdykoli přestavět.
7. **Bezpečné:** asistent ovládá celou aplikaci, proto skripty ve skillech nikdy neběží bez manifestu oprávnění a schválení uživatele.

## 3. Fáze 0 – průzkum (nic nepiš, dokud neskončí)

Prozkoumej repozitář a prostředí a vytvoř krátký report `docs/memory-recon.md`:

- Stack aplikace (jazyk, UI framework, build), jak běží Termux a agenti, jak spolu komunikují.
- Kde a jak asistent volá Gemini API (klient, systémový prompt, nástroje, historie konverzace).
- Existující úložiště, konfigurace, případná stávající „paměť" nebo skilly.
- Existující MCP servery a jak je agenti používají.
- Omezení: verze SQLite (ověř dostupnost FTS5), práva Termuxu, úložiště, WorkManager/obdoba.

Z reportu odvoď konkrétní plán (soubory, moduly, pořadí) a zapiš ho do `docs/memory-plan.md`. Pak pokračuj bez čekání na schválení, pokud plán nemění existující chování aplikace destruktivně.

## 4. Cílová architektura

### 4.1 Vrstvy paměti

| Vrstva | Obsah | Úložiště |
|---|---|---|
| Pracovní | kontext aktuální relace | RAM; kompaktace při ~70 % okna |
| Epizodická | kroky agentů, chyby, výsledky | SQLite (FTS5), decay, sumarizace po 30 dnech |
| Sémantická | trvalá fakta (projekty, prostředí, rozhodnutí, preference) | markdown + frontmatter, git |
| Procedurální | skilly | složky se `SKILL.md`, git |

Rozsahy: **global → projekt → agent**. Užší rozsah přebíjí širší.

### 4.2 Struktura souborů

```
~/.agent/
  memory/{global,projects/<x>,agents/<y>}/*.md
  skills/<name>/{SKILL.md,scripts/,resources/}
  config/models.yaml        # profily modelů a role
  index.db                  # odvozený index (lze smazat a přestavět)
```

Frontmatter záznamu paměti: `name`, `description` (jeden řádek), `scope`, `source` (`stated`/`inferred`), `confidence`, `created`, `updated`, `pinned`, `tags`.
Frontmatter skillu: `name`, `description`, `triggers`, `allowed-tools`, `version`, `permissions` (soubory/síť/příkazy), `status` (`draft`/`probation`/`active`/`disabled`). Formát musí být kompatibilní s běžnými `SKILL.md` konvencemi, aby šly sdílet mezi agenty.

### 4.3 SQLite index

Minimálně tabulky: `memory_items` (+ FTS5 virtuální tabulka), `episodes` (+ FTS5), `skills` (+ FTS5 nad name/description/triggers), `skill_stats` (použití, úspěch, neúspěch, poslední použití), `meta` (verze schématu, hash souborů). Index se při startu a při změně souborů synchronizuje podle hashů. Navrhni migrace.

### 4.4 Adaptér modelů a role

`config/models.yaml` obsahuje profil na model: `context_budget`, `skill_cap`, `max_tools`, `caching`, `structured_output`. Systém volá **role**, ne modely:

- `chat` – hlavní asistent
- `extractor` – levný model, JSON výstup
- `curator` – konsolidace a návrhy skillů, jen na pozadí

Mapování role → model + fallback seznam je konfigurace. Nástroje definuj jednou neutrálně (JSON Schema / MCP) a adaptér je přeloží na function calling daného API. Při přepnutí modelu uprostřed relace stav drží aplikace (ne historie u poskytovatele): pošli shrnutí relace + čerstvě načtenou paměť.

### 4.5 Načítání (před každým tahem, bez LLM)

1. Sestav kontext v pevném pořadí: stabilní prefix (systémový prompt + core paměť ≤ ~300 tokenů) → načtené záznamy (≤ ~600 tokenů) → případný skill → zpráva uživatele. Stabilní prefix první kvůli cachování.
2. Záznamy: FTS5/BM25 nad zprávou + scope (agent > projekt > global) + váha pinned/recency; top 3–5, deduplikované, ořezané na rozpočet z profilu modelu.
3. Skill router: shoda zprávy s `description/triggers` přes FTS; nad prahem vlož tělo **jednoho** skillu (cap z profilu), jinak žádný. Do kontextu nikdy nedávej seznam všech skillů.
4. Nástroje pro model max 3–4: `memory_search`, `skill_load`, `skill_propose` (+ volitelně `memory_read`).

### 4.6 Zápis (po tahu/relaci, na pozadí)

1. Role `extractor` s JSON schématem vrátí kandidáty `{type, scope, text, source, confidence}`.
2. Deterministický kód: validace schématem (při chybě jeden retry, pak zahodit), dedup (hash + FTS podobnost), odmítnutí efemérního obsahu, odmítnutí tajemství (API klíče, tokeny, hesla, SSH klíče se nikdy neukládají), zápis do markdownu, aktualizace indexu.
3. Model nikdy nezapisuje do souborů přímo.
4. Epizody se logují automaticky (kroky agentů, chyby, výsledky) bez LLM.

### 4.7 Konsolidace (na pozadí)

Spouští se jen při nabíjení + idle (WorkManager nebo ekvivalent), dávkově, s časovým stropem. Úkoly: sloučit duplicity, zastarat nepoužívané záznamy (decay), povýšit opakující se epizody na sémantická fakta, sumarizovat epizody starší než 30 dní a smazat surová data, zkontrolovat integritu indexu. Role `curator`.

### 4.8 Životní cyklus skillů

- Detektor v aplikaci: relace s ≥ N úspěšnými kroky nebo stejná sekvence nástrojů ≥ 3× → `curator` vygeneruje draft `SKILL.md`.
- Čistě textový skill: status `probation` (aktivní se sledováním statistik); po X úspěšných použitích se potvrdí, při opakovaném selhání se vypne a označí k revizi.
- Skill se skripty: nikdy se neaktivuje automaticky. Uživatel dostane jedno klepnutí na schválení s přehledem manifestu oprávnění a hashe; při změně skriptu se schvaluje znovu.
- Verze skillů v gitu; volitelný mini-test (vstup + očekávaný výsledek) ke každému skillu.

### 4.9 MCP server

Jeden MCP server (`memory` + `skills`) nad touto strukturou, který používají agenti v terminálu i vestavěný asistent: `memory_search`, `memory_read`, `memory_write` (pro agenty; prochází stejnou validací a dedupem), `skill_list`, `skill_load`, `skill_propose`. Žádná duplicitní logika v GUI a CLI, vše přes jednu knihovnu.

### 4.10 UI

Jednoduchá obrazovka: prohlížení a editace paměti, seznam skillů se statistikami a stavem, fronta schválení (skripty, drafty), tlačítko „přestavět index", přepínač zapnout/vypnout paměť. Žádné nastavování nutné pro běžný provoz.

## 5. Postup a akceptační kritéria

**Fáze 1 – MVP:** markdown paměť + FTS5 index + automatické načítání + extrakce a zápis + skill router + MCP server.
Kritéria: načtení paměti < 20 ms (změř), kontext navíc ≤ 900 tokenů (změř), smazání `index.db` a jeho přestavění bez ztráty dat, jednotkové testy dedupu, validace schématu, rozpočtů a routeru.

**Fáze 2 – samoučení:** `skill_propose`, detektor, probation, statistiky, konsolidační job, fronta schválení.
Kritéria: konsolidace neběží mimo nabíjení/idle, skript bez schválení nejde spustit (test), tajemství se neuloží (test).

**Fáze 3 – pokročilé (jen pokud fáze 1–2 splňují měření):** embeddingy z API počítané při zápisu (ukládej `embedding_model`, při změně přepočítej na pozadí), hybridní vyhledávání, testy skillů, import/export skillů.

Přepnutí modelu: napiš test, který simuluje výměnu modelu uprostřed relace a ověří, že paměť i skilly fungují beze změny kódu, jen konfigurací.

## 6. Pravidla práce

- Nerozbij existující funkce. Nová funkcionalita za feature flagem, dokud neprojde měřením.
- Malé, samostatně otestovatelné commity po logických krocích. Před každou fází krátký plán, po ní krátké shrnutí a výsledky měření.
- Žádná tajemství v repozitáři, logách ani paměti.
- Ošetři chyby sítě, limity API a výpadky modelu (fallback, retry s backoffem, nikdy neblokuj UI).
- Měř a loguj: latenci načítání, velikost vloženého kontextu, úspěšnost extraktoru (prošlo validací/dedupem), úspěšnost skillů; to vše per model.
- Dokumentace: `docs/memory-architecture.md` (jak to funguje), `docs/memory-config.md` (profily modelů, role, rozpočty), `docs/skills-authoring.md` (jak psát skilly).

## 7. Výstup

Funkční systém, testy, dokumentace a krátký závěrečný report: co je hotovo, naměřené hodnoty proti kritériím, známá omezení a doporučené další kroky.
