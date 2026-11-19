

## 3D scéna

- `client/public/models/insane-agent-scene.glb` je runtime kopie modelu nahraného v kořeni repozitáře. Načítá ji `SceneViewport` přes Three.js `GLTFLoader`.
- V režimu VR se renderují dvě instance WebGL scény (`left` a `right`) s posunem kamery pro stereoskopický efekt. Pravé oko je pouze vizuální kopie a nereaguje na dotyk.
- `B33` (`vr.scene.open`) otevře panel `W10` v režimu detailu s náhledem skutečného GLB modelu.
- Pokud bude model nahrazen novým exportem, zachovej cestu `/models/insane-agent-scene.glb`, nebo uprav konstantu v `client/src/components/SceneViewport.tsx`.
