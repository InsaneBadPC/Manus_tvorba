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
| C11–C16 | Zavření panelů | `panel.*.close` | lokální layout preference; případně sync uživatele |

## Aktuální demo vs. reálná integrace

- Chat, metriky, terminál a relace jsou lokální demo stav.
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
