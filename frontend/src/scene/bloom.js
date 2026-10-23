import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import * as THREE from 'three';

/**
 * Tactical Postprocessing Pipeline with 2 Anti-Aliasing Modes:
 * 1. 'fxaa': Fast Approximate Anti-Aliasing (ShaderPass)
 * 2. 'msaa': Hardware Multi-Sample Anti-Aliasing (4x WebGL 2 RenderTarget)
 */
export function setupBloom(renderer, scene, camera, width, height, aaMode = 'fxaa', bloomEnabled = true) {
  let renderTarget = undefined;

  if (aaMode === 'msaa') {
    // Mode 2: Hardware WebGL 2 Multisampled RenderTarget (MSAA 4x)
    renderTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 4
    });
  }

  const composer = new EffectComposer(renderer, renderTarget);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Neon cyan/amber holographic bloom configuration
  let bloomPass = null;
  if (bloomEnabled) {
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      1.6,  // strength
      0.4,  // radius
      0.15  // threshold
    );
    composer.addPass(bloomPass);
  }

  let fxaaPass = null;
  if (aaMode === 'fxaa') {
    // Mode 1: Fast Approximate Anti-Aliasing (FXAA)
    fxaaPass = new ShaderPass(FXAAShader);
    const pr = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.x = 1 / (width * pr);
    fxaaPass.material.uniforms['resolution'].value.y = 1 / (height * pr);
    composer.addPass(fxaaPass);
  }

  composer._fxaaPass = fxaaPass;
  composer._bloomPass = bloomPass;
  composer._aaMode = aaMode;

  return composer;
}

export function updateComposerSize(composer, renderer, width, height) {
  composer.setSize(width, height);
  if (composer._fxaaPass) {
    const pr = renderer.getPixelRatio();
    composer._fxaaPass.material.uniforms['resolution'].value.x = 1 / (width * pr);
    composer._fxaaPass.material.uniforms['resolution'].value.y = 1 / (height * pr);
  }
}
