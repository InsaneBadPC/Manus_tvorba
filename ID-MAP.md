# Insane AI Agent — mapa UI ID a integračních míst

Aplikace je připravená jako dotykový dashboard pro displej telefonu. Každý prvek má `id`, `data-element-id` a `data-hook`; stejné hodnoty lze použít pro automatizované testy, analytics i mapování nativních akcí.

## Konvence

- `Wxx` — okno/panel: stav panelu, viditelnost a lifecycle.
- `Bxx` — tlačítko: uživatelská akce nebo navigace.
- `Cxx` — ovládací prvek: input, select, stavový indikátor nebo zavření panelu.

## Mapování

| ID | Funkce | Hook | Budoucí napojení |
|---|---|---|---|
| W01 | AI Agenti v akci | `panel.window-01` | stav aktivního agenta z API/websocketu |
| W02 | Průběh úkolů | `panel.window-02` | agregace task eventů / telemetry |
| W03 | Aktivní úkoly | `panel.window-03` | `/api/tasks`, live task stream |
| W04 | Využití systému | `panel.window-04` | serverové metriky nebo device metrics |
| W05 | Tok práce agentů | `panel.window-05` | orchestration graph / websocket topology |
| W06 | Agenti & Sessions | `panel.window-06` | `/api/agents`, `/api/sessions`, databáze |
| W07 | Chat & Stream | `panel.window-07` | chat API/websocket; zpráva se posílá z `sendMessage` |
| W08 | Code Diff | `panel.window-08` | Git provider/API; diff payload |
| W09 | Terminál | `panel.window-09` | pouze sandboxovaný backend; nikdy nepouštět raw příkaz z klienta |
| W10 | Prostředí | `panel.window-10` | Capacitor/native bridge pro device nebo 3D režim |
| W11 | Hlasové ovládání | `panel.window-11` | speech-to-text adapter a Android permission |
| B05 | Nastavení | `navigation.settings` | native settings screen / persistent preferences |
| B06 | Nová relace | `sessions.create` | POST `/api/sessions`; po vytvoření aktualizovat session store |
| B07–B09 | Výběr agenta | `agent.select.*` | agent registry a stav dostupnosti |
| B11 | Historie relací | `sessions.history` | GET `/api/sessions?history=true` |
| B12 | Nástroje | `chat.tools` | tool registry / permission model |
| B13 | Git | `chat.git` | OAuth Git provider nebo server adapter |
| B14 | Soubory / otevřít diff | `chat.files`, `diff.open-file` | file browser API / deep link |
| B15 | Spustit terminál | `terminal.run` | bezpečný command job API |
| B16 | Odeslat zprávu | `chat.send` | nahradit lokální demo adapter skutečným API/websocketem |
| B17–B22 | Spodní navigace | `navigation.*` | router / native screen navigation |
| C05 | Výběr streamu | `chat.stream.select` | stream/channel selector |
| C06 | Mikrofon | `chat.voice.input` | Capacitor plugin nebo native speech-to-text bridge |
| C07 | Textový vstup | `chat.text.input` | formulář; validace a offline queue |
| C08 | Terminálový input | `terminal.command.input` | posílat jen do serverového sandboxu |
| C17 | Vysunutí klávesnice | `keyboard.toggle` | čistě lokální UI; v APK lze napojit i Android IME |
| C42 | Zavření klávesnice | `keyboard.close` | lokální UI |
| C18 | Termux příkazový input | `termux.command.input` | native Capacitor TermuxBridge |
| B24 | Přepnout na Chat | `workspace.chat` | přepnutí centrálního pracovního panelu |
| B25 | Přepnout na Termux | `workspace.termux` | zobrazí nativní Termux bridge režim |
| B26 | Spustit příkaz v Termuxu | `termux.run` | `RUN_COMMAND` intent, allowlist a návrat stdout/stderr |
| B27 | Upozornění na novou APK | `app.update.available` | kontrola `latest.json`, download přes AppUpdateBridge |
| B28 | Aktualizovat aplikaci | `app.update.install` | stažení APK a předání Android Package Installeru |
| B29 | Vyčistit Termux výstup | `termux.clear` | pouze lokální UI buffer; případně clear scrollback v nativním terminálu |
| B30 | Reconnect Termux bridge | `termux.reconnect` | znovu navázat native bridge/session |
| B31 | Vyčistit demo terminál | `terminal.clear` | lokální stav konzole |
| B32 | Doplnit help do terminálu | `terminal.help` | rychlá vývojářská nápověda |
| B33 | Otevřít VR scénu | `vr.scene.open` | napojit scene browser / WebXR preview |
| B34 | Spustit VR build | `vr.build` | napojit Termux agent CLI nebo CI job |
| C31–C41 | Zavření panelů W01–W11 | `panel.*.close` | lokální layout preference; případně sync uživatele |

Klávesy vysouvané klávesnice mají ID `K{řádek}{sloupec}` a posílají znaky do právě zvoleného chatu nebo Termux inputu. Výřez původní klávesnice je uložen jako `client/public/keyboard-reference.png`; funkční klávesnice je ale vykreslena jako dotykové HTML ovládání, aby skutečně vkládala znaky.

## Aktualizace APK

GitHub Actions po pushi na `main` sestaví APK, aktualizuje release `latest` a nahraje `latest.json`. Aplikace manifest kontroluje při spuštění. Android instalaci z bezpečnostních důvodů vždy předá systémovému Package Installeru, který může vyžádat potvrzení uživatele; tichá instalace bez potvrzení vyžaduje device-owner/MDM nebo root. Soukromý repozitář `Manus_tvorba` není bez autentizace čitelný z běžné aplikace, proto je pro skutečnou kontrolu z nainstalovaného APK potřeba veřejný update endpoint, veřejný release, nebo vlastní autentizovaný proxy server.

## Aktuální demo vs. reálná integrace

- Chat, metriky, terminál a relace jsou lokální demo stav.
- Chatové zprávy, rozepsaný chat, demo terminál, Termux výstup, oba příkazové řádky a zvolená záložka se ukládají odděleně do `localStorage` pod prefixem `agentvr.*`; přepnutí záložky je proto neničí.
- Centrální Chat a Termux mají vlastní buffer i vlastní rozepsaný příkaz. Demo terminál W09 zůstává oddělený od nativního Termuxu W07.
- Panel Prostředí je připravený jako VR development context: projekt, větev, scene status, WebXR/hot-reload indikátory a rychlé akce Scéna/Build.
- Reálné funkce se mají doplnit přes samostatné adaptery; UI komponenty nemají obsahovat tajné klíče.
- Pro Android mikrofon použít oprávnění `RECORD_AUDIO` a speech plugin/bridge.
- Pro websocket použít reconnect, heartbeat a offline frontu.
- Pro terminal vždy použít allowlist příkazů, izolovaný job runner, timeout a audit log.
- Před produkcí doplnit autentizaci, autorizaci, rate limit a server-side validaci.

## Capacitor APK

Webová aplikace je připravena pro zabalení přes Capacitor. Doporučený postup mimo sandbox:

```bash
pnpm build
npx cap add android
npx cap sync android
npx cap open android
```

V Android Studiu lze následně vytvořit debug APK nebo podepsaný release APK/AAB. Preview v prohlížeči ověřuje pouze webovou vrstvu; nativní mikrofon, notifikace a úložiště je třeba ověřit na skutečném Android zařízení.
