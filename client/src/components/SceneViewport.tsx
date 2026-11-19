import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Eye = "normal" | "left" | "right";

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
    renderer.toneMappingExposure = 1.15;
    renderer.setClearAlpha(0);
    renderer.domElement.className = "scene-canvas";
    renderer.domElement.setAttribute("aria-label", "3D scéna Insane AI Agent VR");
    host.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight(0x8bdcff, 0x061126, 4.2);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0x7bdcff, 6.5);
    key.position.set(4, 7, 6);
    scene.add(key);
    const rim = new THREE.PointLight(0x197dff, 10, 18);
    rim.position.set(-5, 2, -4);
    scene.add(rim);
    const fill = new THREE.PointLight(0x39bfff, 12, 16);
    fill.position.set(0, 3, 4);
    scene.add(fill);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);
    let disposed = false;
    let loaded = false;
    let activePart: THREE.Object3D | null = null;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    new GLTFLoader().load(
      "/models/insane-agent-scene.glb",
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, size.z) || 1;
        model.position.sub(center);
        model.position.y += 0.35;
        model.scale.setScalar(18 / maxAxis);
        model.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = false;
            object.receiveShadow = false;
          }
        });
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
      renderer.dispose();
      renderer.domElement.removeEventListener("pointerdown", handlePointer);
      renderer.domElement.removeEventListener("click", stopClickPropagation);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.domElement.remove();
    };
  }, [eye]);

  return <div ref={hostRef} className={`scene-viewport scene-viewport--${eye}`} aria-hidden="true" />;
}
