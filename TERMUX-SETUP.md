# Termux setup pro Insane AI Agent

Aplikace používá nativní Capacitor plugin `TermuxBridge`, který posílá příkazy do Termuxu přes `com.termux.app.RunCommandService` a vrací stdout, stderr a exit code.

## Co musí být v telefonu

1. Nainstalovat Termux z jednoho důvěryhodného zdroje. Termux a jeho doplňky musí být ze stejného zdroje/podpisu.
2. V Termuxu povolit externí příkazy v `~/.termux/termux.properties`:

```properties
allow-external-apps=true
```

3. Nainstalovat nástroje pro práci s projekty, například:

```bash
pkg update
pkg install git nodejs python clang make
```

4. V nastavení Androidu povolit aplikaci Insane AI Agent dodatečné oprávnění `Run commands in Termux environment`, pokud ho systém nabídne.
5. Pokud projekt leží ve sdíleném úložišti, povolit Termuxu přístup k úložišti pomocí `termux-setup-storage`.
6. Pro dlouhé agenty vypnout agresivní optimalizaci baterie pro Termux.

## Bezpečnostní pravidla bridge

- Příkaz je spuštěn až po explicitním stisku uživatele.
- Výstup je omezený na rozumnou velikost, aby se nepřenášely obří bundle do WebView.
- Produkční verze má doplnit allowlist citlivých operací, potvrzení pro `rm`, `git push`, práci s klíči a přístupem do sdíleného úložiště.
- API klíče agentů nemají být ukládané do WebView localStorage; mají zůstat v Termux environmentu nebo v Android Keystore/secure storage.

## Omezení Androidu

Termux je samostatné nativní prostředí. Tato aplikace ho nebalí dovnitř APK a nesnaží se emulovat shell v JavaScriptu. Centrální panel proto zobrazuje skutečný výsledek příkazů až v APK s nainstalovaným Termuxem; webové Preview používá jasný stav „Termux bridge čeká na APK“.

## Oficiální reference

- RUN_COMMAND intent: https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent
- Termux execution environment: https://github.com/termux/termux-packages/wiki/Termux-execution-environment
- Termux:API: https://github.com/termux/termux-api
