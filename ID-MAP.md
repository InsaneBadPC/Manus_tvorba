
## 3D model jako zdroj UI ve VR

GLB export je hlavní vizuální zdroj VR scény. Obsahuje místnost, pódium, město, textury a 3D UI panely. React/CSS dashboard se v režimu VR vizuálně nepřekresluje přes model; slouží jen jako funkční detail po výběru 3D panelu.

- `part_W01` až `part_W11` — skutečné 3D panely odpovídající ID W01–W11.
- `part_navigace_horní` — horní 3D navigace.
- `part_navigace_spodní` — spodní 3D navigace.
- `part_stav` — 3D stavový panel systému.
- `SceneViewport` používá Three.js `Raycaster`; kliknutí na mesh hledá nejbližšího rodiče `part_*` a předává jeho ID do Reactu.
- Kliknutí na `part_W07` otevře funkční detail Chat & Stream, zatímco model zůstává jediným zdrojem vizuální kompozice.
