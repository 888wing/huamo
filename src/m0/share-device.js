// M0 probe: the sim owns the GPU device, three.js renders on the same device, a raw compute pass fills a 3D
// texture and three samples it through ExternalTexture.
import * as THREE from 'three/webgpu';
import { texture3D, vec3, vec4, uv, uniform } from 'three/tsl';
(async () => {
  const log = {};
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) { window.__report = { error: 'no adapter' }; window.__done = true; return; }
  log.features = [...adapter.features];
  log.adapter = adapter.info ? { vendor: adapter.info.vendor, arch: adapter.info.architecture, desc: adapter.info.description } : null;
  const device = await adapter.requestDevice({ requiredFeatures: [...adapter.features] });
  device.addEventListener('uncapturederror', e => console.error('GPU: ' + e.error.message));
  const N = [64, 32, 64];
  const tex = device.createTexture({ size: N, dimension: '3d', format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
  const prs = device.createTexture({ size: N, dimension: '3d', format: 'r32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const mod = device.createShaderModule({ code: `
    @group(0) @binding(0) var o: texture_storage_3d<rgba16float, write>;
    @group(0) @binding(1) var p: texture_storage_3d<r32float, read_write>;
    @compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) id: vec3u) {
      let q = vec3f(id) / vec3f(${N.join(',')});
      let old = textureLoad(p, id).x;
      textureStore(p, id, vec4f(old + 1.));
      textureStore(o, id, vec4f(q, step(length(q - .5), .4)));
    }` });
  const pipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
  const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
    { binding: 0, resource: tex.createView() }, { binding: 1, resource: prs.createView() }] });
  const enc = device.createCommandEncoder(), cp = enc.beginComputePass();
  cp.setPipeline(pipe); cp.setBindGroup(0, bg); cp.dispatchWorkgroups(N[0] / 4, N[1] / 4, N[2] / 4); cp.end();
  device.queue.submit([enc.finish()]);

  const r = new THREE.WebGPURenderer({ device, antialias: false });
  await r.init();
  r.setSize(innerWidth, innerHeight);
  document.body.appendChild(r.domElement);
  const ext = new THREE.ExternalTexture(tex);
  ext.is3DTexture = true; ext.type = THREE.HalfFloatType; ext.format = THREE.RGBAFormat;
  ext.minFilter = ext.magFilter = THREE.LinearFilter; ext.generateMipmaps = false;
  ext.image = { width: N[0], height: N[1], depth: N[2] };
  const z = uniform(.5);
  const m = new THREE.MeshBasicNodeMaterial();
  const s = texture3D(ext, vec3(uv(), z));
  m.colorNode = vec4(s.rgb.mul(s.a), 1);
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m));
  await r.renderAsync?.(scene, cam) ?? r.render(scene, cam);
  log.three = THREE.REVISION; log.ok = true; log.readWriteStorage = true;
  window.__report = log; window.__done = true;
})().catch(e => { window.__report = { error: String(e.stack || e) }; window.__done = true; });
