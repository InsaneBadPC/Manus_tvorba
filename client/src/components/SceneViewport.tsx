import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Eye = "normal" | "left" | "right";

type MaterialProfile = {
  color: number;
  emissive: number;
  emissiveIntensity: number;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  transparent?: boolean;
};

const REFERENCE_MATERIALS: Record<string, MaterialProfile> = {
  slot_head: { color: 0x020a1b, emissive: 0x020b20, emissiveIntensity: 0.18, metalness: 0.78, roughness: 0.22 },
  slot_trim: { color: 0x042b68, emissive: 0x075fa8, emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.2 },
  slot_ice: { color: 0x0b8dce, emissive: 0x16c8ff, emissiveIntensity: 1.8, metalness: 0.45, roughness: 0.2 },
  slot_pale: { color: 0x9bbdce, emissive: 0x18445d, emissiveIntensity: 0.35, metalness: 0.15, roughness: 0.36, opacity: 0.72, transparent: true },
  slot_muted: { color: 0x34536c, emissive: 0x0b2436, emissiveIntensity: 0.28, metalness: 0.4, roughness: 0.38, opacity: 0.84, transparent: true },
  slot_grid: { color: 0x031b39, emissive: 0x063b72, emissiveIntensity: 0.48, metalness: 0.6, roughness: 0.3 },
  slot_hot: { color: 0x071a3d, emissive: 0x007dff, emissiveIntensity: 1.05, metalness: 0.65, roughness: 0.22 },
  slot_blue: { color: 0x073eaa, emissive: 0x0b9cff, emissiveIntensity: 1.2, metalness: 0.55, roughness: 0.2 },
  slot_mint: { color: 0x0b9c72, emissive: 0x18f0b1, emissiveIntensity: 1.05, metalness: 0.38, roughness: 0.24 },
  slot_gold: { color: 0xe0770b, emissive: 0xffa11c, emissiveIntensity: 1.35, metalness: 0.48, roughness: 0.24 },
  slot_amber: { color: 0x7d2d05, emissive: 0xff5b0b, emissiveIntensity: 1.25, metalness: 0.52, roughness: 0.24 },
  slot_no_n_obloha: { color: 0x010611, emissive: 0x010817, emissiveIntensity: 0.12, metalness: 0.1, roughness: 0.85 },
  slot_hv_zdy: { color: 0x2f6dbe, emissive: 0x58bfff, emissiveIntensity: 0.9, metalness: 0.12, roughness: 0.6 },
  slot_m_sto: { color: 0x020916, emissive: 0x031c3b, emissiveIntensity: 0.35, metalness: 0.55, roughness: 0.42 },
  slot_modr: { color: 0x064e9f, emissive: 0x0a9bff, emissiveIntensity: 0.9, metalness: 0.42, roughness: 0.3 },
  slot_okna_modr: { color: 0x0873c5, emissive: 0x21caff, emissiveIntensity: 1.35, metalness: 0.28, roughness: 0.18 },
  slot_okna_tepl: { color: 0xb8430a, emissive: 0xff7a16, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.2 },
  slot_pr_zor: { color: 0x051a31, emissive: 0x0b4c78, emissiveIntensity: 0.48, metalness: 0.55, roughness: 0.28 },
  slot_steel: { color: 0x102c4d, emissive: 0x0b5e8f, emissiveIntensity: 0.35, metalness: 0.88, roughness: 0.24 },
};

function tuneReferenceMaterials(model: THREE.Object3D, renderer: THREE.WebGLRenderer) {
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = false;
    object.receiveShadow = false;
    object.renderOrder = object.name.startsWith("mesh_") ? 2 : 1;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      const name = material.name.toLowerCase();
      const profile = REFERENCE_MATERIALS[name];
      const target = material as THREE.MeshStandardMaterial & { map?: THREE.Texture; envMapIntensity?: number };
      if (target.map) {
        target.map.colorSpace = THREE.SRGBColorSpace;
        target.map.anisotropy = anisotropy;
        target.map.minFilter = THREE.LinearMipmapLinearFilter;
        target.map.magFilter = THREE.LinearFilter;
        target.map.needsUpdate = true;
      }
      if (!profile) return;
      if ("color" in target) target.color.setHex(profile.color);
      if ("emissive" in target) {
        target.emissive.setHex(profile.emissive);
        target.emissiveIntensity = profile.emissiveIntensity;
      }
      if (profile.metalness !== undefined && "metalness" in target) target.metalness = profile.metalness;
      if (profile.roughness !== undefined && "roughness" in target) target.roughness = profile.roughness;
      if (profile.opacity !== undefined) target.opacity = profile.opacity;
      if (profile.transparent !== undefined) target.transparent = profile.transparent;
      target.envMapIntensity = 0.42;
      target.needsUpdate = true;
    });
  });
}

export function SceneViewport({ eye = "normal", onPartClick }: { eye?: Eye; onPartClick?: (part: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020b18);
    scene.fog = new THREE.Fog(0x020b18, 8, 26);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
    camera.position.set(eye === "left" ? -0.035 : eye === "right" ? 0.035 : 0, 4.6, 8.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;
    renderer.setClearAlpha(0);
    renderer.domElement.className = "scene-canvas";
    renderer.domElement.setAttribute("aria-label", "3D scéna Orin VR");
    host.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight(0x8bdcff, 0x061126, 1.7);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0x7bdcff, 2.8);
    key.position.set(4, 7, 6);
    scene.add(key);
    const rim = new THREE.PointLight(0x197dff, 5.8, 18);
    rim.position.set(-5, 2, -4);
    scene.add(rim);
    const fill = new THREE.PointLight(0x39bfff, 6.2, 16);
    fill.position.set(0, 3, 4);
    scene.add(fill);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);
    const disposeTree = (root: THREE.Object3D) => {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value instanceof THREE.Texture) value.dispose();
          });
          material.dispose();
        });
      });
    };
    let disposed = false;
    let loaded = false;
    let activePart: THREE.Object3D | null = null;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    new GLTFLoader().load(
      "/models/insane-agent-scene.glb",
      (gltf) => {
        if (disposed) {
          disposeTree(gltf.scene);
          return;
        }
        const model = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, size.z) || 1;
        model.position.sub(center);
        model.position.y += 0.35;
        model.scale.setScalar(18 / maxAxis);
        tuneReferenceMaterials(model, renderer);
        modelRoot.add(model);
        loaded = true;
      },
      undefined,
      (error) => console.warn("Scene GLB se nepodařilo načíst", error),
    );

    const handlePointer = (event: PointerEvent) => {
      if (!loaded || eye === "right") return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(modelRoot.children, true)[0];
      if (!hit) return;
      let node: THREE.Object3D | null = hit.object;
      while (node && !/^part_/.test(node.name)) node = node.parent;
      if (!node) return;
      if (activePart && activePart !== node) activePart.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => { if ("emissive" in material) (material as THREE.MeshStandardMaterial).emissive.setHex(0x000000); });
        }
      });
      activePart = node;
      activePart.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => { if ("emissive" in material) (material as THREE.MeshStandardMaterial).emissive.setHex(0x124f80); });
        }
      });
      onPartClick?.(node.name.replace(/^part_/, ""));
    };
    const stopClickPropagation = (event: MouseEvent) => event.stopPropagation();
    renderer.domElement.addEventListener("pointerdown", handlePointer);
    renderer.domElement.addEventListener("click", stopClickPropagation);

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      if (disposed) return;
      const elapsed = clock.getElapsedTime();
      if (loaded) modelRoot.rotation.y = Math.sin(elapsed * 0.16) * 0.025;
      camera.lookAt(0, 0.8, 0);
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointer);
      renderer.domElement.removeEventListener("click", stopClickPropagation);
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [eye]);

  return <div ref={hostRef} className={`scene-viewport scene-viewport--${eye}`} aria-hidden="true" />;
}
