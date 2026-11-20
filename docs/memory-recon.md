# Fáze 0 — recon: paměť, skilly a vestavěný asistent

Datum: 2026-11-19  
Repozitář: `InsaneBadPC/Manus_tvorba` (commit `a4ffdc4` + dva specifikační dokumenty)  
Metoda: čtení kódu, konfigurace a build skriptů; měření FTS5 v Node 24 přímo v Termuxu.  
Rozsah: pouze průzkum. V této fázi nebyl změněn žádný kód aplikace.

## 1. Co aplikace je

- Webové UI: React 19 + Vite + Tailwind + Radix, stav v Reactu a `localStorage`.
- Backend: Express 4 + tRPC 11 + Drizzle/MySQL. Server se buildí do `dist/index.js`, ale **do APK se nedostane**.
- APK: Capacitor 8, `webDir: "dist/public"`, tedy jen statické assety. `capacitor.config.ts` zakazuje cleartext i mixed content.
- Android: `minSdk 24`, `compileSdk/targetSdk 36`, Java (žádný Kotlin), čtyři vlastní bridge pluginy.
- CI: GitHub Actions staví a podepisuje release APK; lokálně Android SDK není, nativní změny jdou ověřit jen v CI.

Důsledek: cokoli, co má fungovat offline v APK, nemůže spoléhat na `server/`. Serverové `_core/llm.ts` je součást platformního backendu, ne zařízení.

## 2. Vestavěný asistent

V repozitáři **není** žádný klient jazykového modelu:

- žádná závislost na Gemini/Google SDK, žádný `GEMINI_API_KEY`;
- žádný systémový prompt, historie konverzace ani tool calling;
- W07 „Chat & Stream“ neposílá zprávu modelu. `sendMessage()` v `client/src/pages/Home.tsx` vezme text, ověří aktivní projekt a přiřazeného CLI agenta a spustí:

```
printf '%s\n' "<text>" | <cli>
```

- odpovědí je surový stdout CLI agenta; žádné tokeny, role, nástroje ani rozpočty;
- zprávy UI jsou v `useStoredState` (`localStorage`), ne v databázi relace.

Specifikace asistenta (`specifikace-asistenta.md`) i systém paměti (`agent-prompt-memory-skills.md`) tedy popisují vrstvu, která v aplikaci dosud neexistuje. Není co „připojit před volání modelu“, dokud nevznikne assistant klient.

## 3. Termux bridge

`TermuxBridgePlugin.java` + `TermuxResultReceiver.java`:

- odesílá `RUN_COMMAND` broadcast do Termuxu, vyžaduje `com.termux.permission.RUN_COMMAND`;
- parametry: příkaz, `cwd`, shell `bash`/`sh`;
- timeout 120 s, max. délka příkazu 8 192 znaků, max. výstup 200 000 znaků;
- vrací stdout/stderr/exit kód jednorázově, bez streamování;
- neumí držet běžící proces, přidělit mu ID, číst výstup po částech ani ho ukončit.

To je zásadní omezení pro „dlouhé procesy na pozadí“ z katalogu nástrojů. Buď se bridge rozšíří o session API, nebo se dlouhé úlohy řeší uvnitř Termuxu (MCP server / foreground service).

## 4. Úložiště a soubory

- Projekty: Android SAF `ACTION_OPEN_DOCUMENT_TREE`, persistovaný `content://` grant a odvozená cesta `/storage/emulated/0/...` pro Termux.
- V projektu se vytváří `.agentvr/project.json`.
- Sessions, soubory a Git se čtou přes Termux (`find`, `sed`, `git`, `tail`).
- Aplikace nemá vlastní SQLite ani jinou perzistentní DB; používá `localStorage` a soubory.
- `~/.agent/` z dokumentu je `HOME` Termuxu, tj. `/data/data/com.termux/files/home`. **Proces APK tam nemá přístup**; může tam zapisovat jen přes `RUN_COMMAND`.

Důsledek: markdown paměť a `index.db` v `~/.agent` musí spravovat proces běžící v Termuxu. Nativní Java modul by na ně nedosáhl, pokud by se nezměnila lokace nebo nepřidala další cesta přes bridge.

## 5. Android a prostředí

- Manifest: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `REQUEST_INSTALL_PACKAGES`, `com.termux.permission.RUN_COMMAND`.
- Žádná foreground service, WorkManager, Kotlin, Room ani SQLite helper.
- Termux na tomto zařízení: Node **v24.18.0**, pnpm 10.18.0, `sqlite3` CLI není v `PATH`.
- `node:sqlite` je dostupné a **FTS5 funguje** (ověřeno vytvořením virtuální tabulky a dotazem `MATCH`).
- Měření: 5 000 záznamů, dotaz `bm25`, top 5, průměr **8,2 ms** na dotaz (in-memory, Node v Termuxu). Cíl < 20 ms je reálně splnitelný pro samotný index; bridge IPC se do tohoto čísla nepočítá.
- CI neobsahuje instrumentační ani nativní testy; testy jsou TS (Vitest). Instalace APK na fyzické zařízení v tomto prostředí neproběhla.

## 6. Co v repozitáři chybí

| Požadavek ze specifikace | Stav |
|---|---|
| Assistant klient (Gemini, systémový prompt, historie) | chybí |
| Adaptér rolí `chat`/`extractor`/`curator`, `models.yaml` | chybí |
| Neutrální registr nástrojů a function calling | chybí |
| `~/.agent/memory`, `~/.agent/skills` | chybí |
| SQLite index + FTS5 + migrace | chybí |
| Automatická extrakce, dedup, filtr tajemství | chybí |
| Skill router, `SKILL.md`, statistiky, probation | chybí |
| MCP server `memory`/`skills` | chybí |
| Foreground service pro dlouhé úlohy | chybí |
| Audit log, undo, potvrzovací karty, kill switch | chybí |
| Obrazovka paměti/skillů v UI | chybí |
| Gemini API klíč a konfigurace modelů | chybí |

## 7. Rozpory a rizika

1. **Asistent neexistuje.** Paměť nelze integrovat „před každým tahem modelu“, dokud nevznikne modelový klient. Pořadí prací musí být: základ paměti a MCP → assistant adaptér → napojení na UI.
2. **`~/.agent` je jen v Termuxu.** Nativní Kotlin/Java vrstva na něj nedosáhne. Buď poběží logika v Termuxu, nebo se úložiště přesune do sdíleného prostoru (což odporuje zadání).
3. **20 ms vs. bridge.** Index je rychlý, ale každé volání přes `RUN_COMMAND` je nový proces a broadcast. Pro „< 20 ms na tah“ je potřeba persistentní služba v Termuxu, ne shell na každý dotaz.
4. **Chybí API klíč.** Live extrakce a chat nelze otestovat; adaptér lze postavit proti fake modelu a testovat deterministicky.
5. **Kotlin vs. Java.** Projekt je celý v Javě a bez Android SDK lokálně. Zavádět Kotlin modul kvůli paměti je zbytečné; paměťová logika patří do Termuxu a Java zůstane jen tenký bridge.
6. **MCP v Termuxu vyžaduje Node/pnpm.** Na zařízení jsou, ale je to nová runtime závislost, kterou je potřeba zdokumentovat a ověřit při startu.
7. **Soukromí.** `memory_write` od agentů musí projít stejnou validací a filtrem tajemství jako zápis z aplikace; jinak se klíče dostanou do gitu.

## 8. Závěr pro plán

Nejmenší funkční a měřitelná Fáze 1 je **model-agnostické paměťové jádro běžící v Termuxu**:

- markdown + frontmatter v `~/.agent`,
- SQLite FTS5 index s hash synchronizací,
- deterministické načítání a rozpočty,
- extrakce přes rozhraní adaptéru (fake pro testy, Gemini později),
- skill router a MCP stdio server,
- měření a testy podle akceptačních kritérií.

Až to bude stát a měřit, připojí se assistant klient a UI. Nativní služba a potvrzovací karty přijdou ve Fázi 2, protože bez existujícího asistenta nemají co obsluhovat.
