import * as THREE from 'three';
const r = new THREE.WebGLRenderer({ antialias: true });
document.body.appendChild(r.domElement);
const s = new THREE.Scene(), c = new THREE.PerspectiveCamera(60, 1, .1, 100);
s.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
c.position.z = 3; r.render(s, c);
