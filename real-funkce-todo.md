# Reálně funkční systém — TODO a ověření

Pravidlo: `OK` lze použít jen tehdy, když funkce používá skutečný Android/Web API, Termux CLI, backend nebo GitHub workflow. Lokální simulace, náhodné hodnoty a předstírané odpovědi se nepovažují za funkční.

| Stav | Oblast | Co musí být skutečně ověřeno |
|---|---|---|
| ČÁSTEČNĚ | Termux bridge | APK odešle příkaz přes RUN_COMMAND do nainstalovaného Termuxu a zobrazí stdout/stderr/exit code. |
| ČÁSTEČNĚ | AI CLI agenti | Kilo Code, Antigravity a Freebuff CLI mají konfigurovatelný skutečný příkaz a jeho výstup se vrací do UI; UI navíc skenuje session/conversation soubory v HOME Termuxu. |
| ČÁSTEČNĚ | Spolupráce agentů | Jeden úkol lze spustit u více skutečně nakonfigurovaných CLI agentů a výsledky se sloučí. |
| OK (web) | Graf práce agentů | Graf zobrazuje skutečný běh/stav úloh, ne statickou dekoraci. |
| OK (bridge + fallback) | Baterie | Hodnota pochází z Android BatteryManager nebo dostupného systémového API. |
| ČÁSTEČNĚ | Wi-Fi/signál | Hodnota pochází z Android Connectivity/Wi-Fi API; při nedostupnosti je jasně uvedeno N/A. |
| OK (bridge + fallback) | Rychlost sítě | Hodnota pochází z Android linkDownstreamBandwidth nebo měřeného přenosu. |
| ČÁSTEČNĚ | CPU/RAM | Hodnota pochází ze systémového bridge, nikoli z náhodného generátoru. |
| ČÁSTEČNĚ | Správce souborů a session historie | Výpis, otevření a práce se soubory používá skutečný Termux/filesystem bridge. |
| OK (web) | Klávesnice | Dotyková klávesnice skutečně zapisuje do aktuálního vstupu a odesílá příkaz/zprávu. |
| ČÁSTEČNĚ | Hlasové ovládání | Používá skutečné Speech Recognition API nebo Android SpeechRecognizer. |
| ČÁSTEČNĚ | Automatická aktualizace APK | Aplikace načte latest.json, porovná build SHA, stáhne APK a předá ho systémovému instalátoru. |
| OK (workflow) | GitHub APK build | Každý push spustí GitHub Actions; main vytvoří APK artifact/release. |

## Ověřovací záznam

Položka se označí `OK` až po úspěšném testu v odpovídajícím runtime. Web preview bez Androidu/Termuxu se počítá pouze jako ověření fallbacku. Stav ČÁSTEČNĚ znamená, že kód a fallback jsou připravené, ale v tomto sandboxu nebylo možné nainstalovat APK do fyzického Androidu a potvrdit celý nativní tok.

## Ověřeno v této iteraci

- Odstraněn náhodný generátor CPU/RAM/GPU; nedostupná data se zobrazují jako `N/A`.
- W02/W03/W05 používají uložené skutečné runtime události místo statického grafu/úloh.
- Hlasové tlačítko používá Speech Recognition API a při absenci runtime vrací jasnou chybu.
- Čas je aktuální, počasí je přiznaně `N/A` bez připojeného weather API.
- `pnpm check` a `pnpm build` prošly.

- Doplněno tlačítko B11 pro skutečné vyhledání session/conversation/JSONL souborů v HOME Termuxu, načtení metadat a otevření posledních 120 řádků session.
