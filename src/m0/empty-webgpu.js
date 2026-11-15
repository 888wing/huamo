import * as THREE from 'three/webgpu';
(async () => {
const r = new THREE.WebGPURenderer({ antialias: true });
await r.init();
document.body.appendChild(r.domElement);
const s = new THREE.Scene(), c = new THREE.PerspectiveCamera(60, 1, .1, 100);
s.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial()));
c.position.z = 3; r.render(s, c);
})();
