import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as THREE from 'three';

export function setupBloom(renderer, scene, camera, width, height) {
  const composer = new EffectComposer(renderer);
  
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  
  // Neon cyan/amber holographic bloom configuration
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    1.6,  // strength
    0.4,  // radius
    0.15  // threshold
  );
  composer.addPass(bloomPass);

  return composer;
}
