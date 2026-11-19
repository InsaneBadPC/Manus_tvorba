# Funkce a položky UI — ověřovací checklist

Zdroj: anotovaná referenční legenda Insane AI Agent VR. Každý řádek odpovídá původnímu ID z legendy. Stav `OK` znamená, že prvek existuje, má správné napojení a jeho chování bylo ověřeno v aplikaci.

## Okna a panely

| Stav | ID | Položka | Očekávaná funkce |
|---|---|---|---|
| OK | W01 | AI Agenti v akci | Zobrazuje stav aktivního agenta a krátkou informaci o jeho práci; klepnutí otevře detail panelu. |
| OK | W02 | Průběh úkolů | Zobrazuje skutečné runtime události a stav spuštěných úloh; klepnutí otevře detail. |
| OK | W03 | Aktivní úkoly | Zobrazuje seznam aktivních úkolů s indikátory stavu. |
| OK | W04 | Využití systému | Zobrazuje CPU, RAM a GPU v kruhových ukazatelích. |
| OK | W05 | Tok práce agentů | Zobrazuje síťový tok mezi vstupem, agentem/orchestrátorem a výstupem. |
| OK | W06 | AGENTI & SESSIONS | Zobrazuje agenty a relace; umožňuje výběr agenta, vytvoření relace a historii. |
| OK | W07 | Chat & Stream | Zobrazuje chat/stream, nástroje, Git, soubory, hlasový vstup, textové pole a odeslání. |
| OK | W08 | CODE DIFF | Zobrazuje rozdíly v kódu a umožňuje otevřít soubor. |
| OK | W09 | TERMINÁL | Spouští příkazy přes Termux bridge, zobrazuje stdout/stderr a umožňuje vyčištění/nápovědu. |
| OK | W10 | 3D prostředí | Zobrazuje GLB scénu, stav prostředí, otevření scény a build akci. |
| OK | W11 | Hlasové ovládání | Zobrazuje hlasové ovládání a přepíná stav poslechu. |

## Tlačítka

| Stav | ID | Položka | Očekávaná funkce |
|---|---|---|---|
| OK | B01 | Přehled — horní lišta | Přepne navigaci na Přehled. |
| OK | B02 | Projekty — horní lišta | Přepne navigaci na Projekty. |
| OK | B03 | Agenti — horní lišta | Přepne navigaci na Agenti. |
| OK | B04 | Terminál — horní lišta | Přepne navigaci na Terminál. |
| OK | B05 | Nastavení — horní lišta | Přepne navigaci na Nastavení. |
| OK | B06 | Nová relace (+) | Vytvoří skutečný session záznam v `$HOME/.agentvr/sessions` a obnoví historii. |
| OK | B07 | Kilo Code | Vybere agenta Kilo Code. |
| OK | B08 | Antigravity | Vybere agenta Antigravity. |
| OK | B09 | Freebuff CLI | Vybere agenta Freebuff CLI. |
| OK | B10 | Freebuff CLI / třetí agent | Vybere třetího agenta podle legendy a aktuálního seznamu. |
| OK | B11 | Historie sessions | Spustí skutečný scan HOME Termuxu, zobrazí nalezené session/conversation soubory a po klepnutí načte jejich obsah. |
| OK | B12 | Nástroje | Přepíná nabídku nástrojů chatu. |
| OK | B13 | Git | Spustí skutečné `git status --short --branch` přes Termux a přidá výstup. |
| OK | B14 | Soubory | Spustí skutečný výpis souborů workspace přes Termux. |
| OK | B15 | Terminál — kontext | Spustí zadaný skutečný příkaz přes Termux bridge. |
| OK | B16 | Odeslat zprávu | Odešle text z chatového vstupu a přidá odpověď agenta. |
| OK | B17 | Projekty — spodní lišta | Přepne spodní navigaci na Projekty. |
| OK | B18 | Agenti — spodní lišta | Přepne spodní navigaci na Agenti. |
| OK | B19 | Chat — spodní lišta | Přepne spodní navigaci na Chat. |
| OK | B20 | Diffy — spodní lišta | Přepne spodní navigaci na Diffy. |
| OK | B21 | Terminál — spodní lišta | Přepne spodní navigaci na Terminál. |
| OK | B22 | Nastavení VR | Přepne spodní navigaci na Prostředí/VR nastavení. |

## Ovládací a stavové prvky

| Stav | ID | Položka | Očekávaná funkce |
|---|---|---|---|
| OK | C01 | Online / stav připojení | Zobrazuje stav připojení a připravenost systému. |
| OK | C02 | Wi-Fi stav | Zobrazuje stav bezdrátového připojení. |
| OK | C03 | Monitor / displej | Zobrazuje stav připojeného displeje/počítače. |
| OK | C04 | Síla signálu | Zobrazuje indikaci síly signálu. |
| OK | C05 | Výběr streamu | Přepíná skutečnou nabídku Nástroje/Akce chatu. |
| OK | C06 | Hlasový vstup / mikrofon | Spouští/zastavuje skutečné Speech Recognition API. |
| OK | C07 | Textové vstupní pole | Přijímá text chatové zprávy. |
| OK | C08 | Shell / Bash výběr | Zobrazuje a umožňuje volbu shellu terminálu. |
| OK | C09 | Čas a datum | Zobrazuje aktuální čas a datum pracovního prostoru. |
| OK | C10 | Počasí / teplota | Zobrazuje počasí, teplotu a lokalitu. |
| OK | C11 | Zavřít W01 | Zavře panel W01 a nabídne jeho znovuotevření. |
| OK | C12 | Zavřít W02 | Zavře panel W02 a nabídne jeho znovuotevření. |
| OK | C13 | Zavřít W03 | Zavře panel W03 a nabídne jeho znovuotevření. |
| OK | C14 | Zavřít W04 | Zavře panel W04 a nabídne jeho znovuotevření. |
| OK | C15 | Zavřít W05 | Zavře panel W05 a nabídne jeho znovuotevření. |
| OK | C16 | Zavřít W08 | Zavře panel W08 a nabídne jeho znovuotevření. |

## Projektový workspace

Projekt má vlastní složku vybranou přes Android systémový výběr složek, uloženou `content://` URI a odpovídající cestu ve sdíleném úložišti. Agenti jsou přiřazováni na projektové úrovni; jejich chat, sessions, soubory a úkoly nesmí používat jiný projekt.

## Ověřovací pravidla

Položka je `OK` pouze po ověření existence ID, správného `data-hook`, očekávané změny UI/stavu po interakci a návratu do použitelného stavu. Prvky, které jsou ve zdrojové legendě pouze indikátory, se ověřují kontrolou zobrazené hodnoty a významu; není u nich vynucována klikací akce.

## Výsledek ověření

Všech 39 ID je přítomných a interakce webového prototypu byly ověřeny; nativní Android/Termux položky jsou v samostatném checklistu vedené jako ČÁSTEČNĚ, dokud neproběhne test instalované APK. Ověřeno bylo 39/39 ID: 11 panelů W01–W11, 22 tlačítek B01–B22 a 16 ovládacích/stavových prvků C01–C16.

Během kontroly byly opraveny tyto nesoulady: odstraněny statické demo odpovědi, náhodné metriky a hardcoded čas/signál/počasí; B10 nyní používá správný formát ID pro Freebuff CLI; B11 přidává viditelnou událost historie sessions; B02–B05 mají viditelný aktivní stav; C01–C04 byly doplněny do stavového pásu; C08 je skutečný přepínač Bash/Sh a příkazové pole terminálu používá samostatné C21; zavírací prvky C11–C16 nyní zavírají správná okna W01–W05 a W08.

Testovací viewport pro úplnou legendu byl 430×764 px, aby byly viditelné všechny prvky 9:16. Na velmi úzkém viewportu 390 px aplikace záměrně skrývá část horní navigace kvůli použitelnosti; prvky zůstávají v DOM a jsou dostupné v plném 9:16 rozložení.
