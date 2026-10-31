import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Calibrated for The Short Ball: a 40 x 14 slab needs a +-23 m shadow frustum
// (the template's +-13 fits 21 x 14), and 4096 texels keep ~1.1 cm per texel.
/** opts.extent: shadow frustum half-size (the game's oval needs +-30). */
export function createLighting(renderer, scene, opts = {}) {
  const ext = opts.extent ?? 23;
  const hemi = new THREE.HemisphereLight(0xd6ecf6, 0x6f6a60, 0.24);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff8ee, 3.3);
  sun.position.set(-22, 29, 25);
  sun.target.position.set(0, -0.4, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -ext;
  sun.shadow.camera.right = ext;
  sun.shadow.camera.top = ext;
  sun.shadow.camera.bottom = -ext;
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 1.0;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0xa9cbe2, 0.46);
  fill.position.set(19, 13, -15);
  fill.target.position.set(0, -0.5, 0);
  scene.add(fill);
  scene.add(fill.target);

  // Aquatic subjects set scene.userData.aquatic = true before lighting.
  // A dry scene must not get a cyan bounce from below the deck.
  let waterBounce = null;
  if (scene.userData.aquatic) {
    waterBounce = new THREE.PointLight(0x74cfd2, 1.7, 11, 2.0);
    waterBounce.position.set(0.3, -0.9, 0.0);
    scene.add(waterBounce);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const env = pmrem.fromScene(envScene, 0.035).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.18;
  pmrem.dispose();
  envScene.dispose?.();

  return { sun, hemi, fill, waterBounce, env };
}
