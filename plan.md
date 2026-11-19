# Projektový workspace model

## Cíl
Aplikace bude mít skutečné projekty, přičemž každý projekt má vlastní složku ve sdíleném úložišti zařízení vybranou Android systémovým pickerem, uloženou `content://` URI, odpovídající `/storage/emulated/0/...` cestu pro Termux, vlastní přiřazené CLI agenty, sessions, soubory, úkoly a historii. Žádná akce agenta nesmí implicitně používat privátní `~/agentvr` workspace.

## Datový model
- `Project`: stabilní ID, název, `content://` URI, Termux cesta ve sdíleném úložišti, přiřazené CLI agent příkazy, datum vytvoření.
- `ProjectSession`: session soubor nebo session ID nalezené uvnitř projektové cesty.
- `ProjectTask`: úkol s agentem, stavem queued/running/succeeded/failed/cancelled a výstupem.
- `Agent`: globální katalog dostupných CLI harnessů; přiřazení se drží na projektu.

## Chování
1. Uživatel vytvoří projekt a vybere skutečnou složku zařízení přes Android Storage Access Framework.
2. Aplikace trvale uloží oprávnění k URI, ověří přístup Termuxu ke sdílenému úložišti a vytvoří projektový manifest `.agentvr/project.json` v dané složce.
3. Uživatel k projektu přidává nebo odebírá agenty.
4. Chat, terminál, Git, soubory, session scan a collaborative run vždy používají cestu aktivního projektu ve sdíleném úložišti.
5. Sessions se hledají uvnitř aktivního projektu a zobrazují se s agentem, cestou a obsahem.
6. Úkoly a runtime události jsou vázané na projekt; přepnutí projektu nemění data jiného projektu.

## Ověřené vzory
- VS Code: workspace může obsahovat jednu nebo více explicitních kořenových složek.
- Cursor Projects: projekt vlastní kontext, agenty a seznam práce; agenti jsou do projektu přidáváni/odebíráni.
- OpenHands Agent Canvas: lokální workspace, více agentů, izolované běhy a přepínatelný backend.

## Následující implementační pořadí
1. Projektový store, výběr projektu, vytvoření/odebrání projektu.
2. Přiřazení/odebrání CLI agentů na projektu.
3. Přesměrování všech Termux příkazů na aktivní projektovou cestu.
4. Session/file/task scoping podle aktivního projektu.
5. Přesné resume adaptéry podle skutečného `--help` výstupu každého CLI.

## Android storage rozhodnutí

Projektová složka se vybírá přes `ACTION_OPEN_DOCUMENT_TREE`, aplikace si bere persistable read/write URI grant a ukládá také Termux cestu pro primary shared storage. Termux musí mít jednorázově povolený přístup přes `termux-setup-storage`; projekty se nesmí ukládat do privátního Termux HOME, protože tam běžný správce souborů nemá uživatelský přístup.

Zdroje: Android Storage Access Framework (`ACTION_OPEN_DOCUMENT_TREE` a persistable URI permission), Android 11 scoped-storage omezení a Termux `termux-setup-storage`.
