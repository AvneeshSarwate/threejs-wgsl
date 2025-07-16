import * as THREE from 'three/webgpu';
import { uniform, instancedArray, wgslFn, attribute, Fn, instanceIndex, varying, vec4, sub, positionLocal, add, modelWorldMatrix, cameraProjectionMatrix, cameraViewMatrix } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import velocityComputeWGSL from './shaders/velocity-compute.wgsl?raw';
import positionComputeWGSL from './shaders/position-compute.wgsl?raw';
import birdVertexWGSL from './shaders/bird-vertex.wgsl?raw';

let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGPURenderer;
let last = performance.now();

let pointer: THREE.Vector2;
let raycaster: THREE.Raycaster;
let computeVelocity: any;
let computePosition: any;
let effectController: any;

const BIRDS = 16384;
const SPEED_LIMIT = 9.0;
const BOUNDS = 800;
const BOUNDS_HALF = BOUNDS / 2;

// Custom Geometry - using 3 triangles each
class BirdGeometry extends THREE.BufferGeometry {
  constructor() {
    super();

    const trianglesPerBird = 3;
    const triangles = BIRDS * trianglesPerBird;
    const points = triangles * 3;

    const vertices = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
    const references = new THREE.BufferAttribute(new Uint32Array(points), 1);
    const birdVertex = new THREE.BufferAttribute(new Uint32Array(points), 1);

    this.setAttribute('position', vertices);
    this.setAttribute('reference', references);
    this.setAttribute('birdVertex', birdVertex);

    let v = 0;

    function verts_push(...args: number[]) {
      for (let i = 0; i < args.length; i++) {
        vertices.array[v++] = args[i];
      }
    }

    const wingsSpan = 20;

    for (let f = 0; f < BIRDS; f++) {
      // Body
      verts_push(0, 0, -20, 0, -8, 10, 0, 0, 30);

      // Wings
      verts_push(0, 0, -15, -wingsSpan, 0, 5, 0, 0, 15);
      verts_push(0, 0, 15, wingsSpan, 0, 5, 0, 0, -15);
    }

    for (let v = 0; v < triangles * 3; v++) {
      const triangleIndex = ~~(v / 3);
      const birdIndex = ~~(triangleIndex / trianglesPerBird);

      references.array[v] = birdIndex;
      birdVertex.array[v] = v % 9;
    }

    this.scale(0.2, 0.2, 0.2);
  }
}

async function init() {
  // Camera setup
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 5000);
  camera.position.z = 1000;

  // Scene setup
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 700, 3000);

  // Pointer setup
  pointer = new THREE.Vector2();
  raycaster = new THREE.Raycaster();

  // Sky
  const geometry = new THREE.IcosahedronGeometry(1, 6);
  const material = new THREE.MeshBasicNodeMaterial({
    colorNode: varying(
      vec4(
        sub(0.25, positionLocal.y),
        sub(-0.25, positionLocal.y),
        add(1.5, positionLocal.y),
        1.0
      )
    ),
    side: THREE.BackSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.z = 0.75;
  mesh.scale.setScalar(1200);
  scene.add(mesh);

  // WebGPU Renderer setup
  renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setAnimationLoop(animate);
  renderer.toneMapping = THREE.NeutralToneMapping;
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);

  // Initialize position, velocity, and phase values
  const positionArray = new Float32Array(BIRDS * 3);
  const velocityArray = new Float32Array(BIRDS * 3);
  const phaseArray = new Float32Array(BIRDS);

  for (let i = 0; i < BIRDS; i++) {
    const posX = Math.random() * BOUNDS - BOUNDS_HALF;
    const posY = Math.random() * BOUNDS - BOUNDS_HALF;
    const posZ = Math.random() * BOUNDS - BOUNDS_HALF;

    positionArray[i * 3 + 0] = posX;
    positionArray[i * 3 + 1] = posY;
    positionArray[i * 3 + 2] = posZ;

    const velX = Math.random() - 0.5;
    const velY = Math.random() - 0.5;
    const velZ = Math.random() - 0.5;

    velocityArray[i * 3 + 0] = velX * 10;
    velocityArray[i * 3 + 1] = velY * 10;
    velocityArray[i * 3 + 2] = velZ * 10;

    phaseArray[i] = 1;
  }

  // Storage arrays
  const positionStorage = instancedArray(positionArray, 'vec3').label('positionStorage');
  const velocityStorage = instancedArray(velocityArray, 'vec3').label('velocityStorage');
  const phaseStorage = instancedArray(phaseArray, 'float').label('phaseStorage');

  // PBO for WebGL2 fallback
  positionStorage.setPBO(true);
  velocityStorage.setPBO(true);
  phaseStorage.setPBO(true);

  // Define Uniforms
  effectController = {
    separation: uniform(15.0).label('separation'),
    alignment: uniform(20.0).label('alignment'),
    cohesion: uniform(20.0).label('cohesion'),
    freedom: uniform(0.75).label('freedom'),
    now: uniform(0.0),
    deltaTime: uniform(0.0).label('deltaTime'),
    rayOrigin: uniform(new THREE.Vector3()).label('rayOrigin'),
    rayDirection: uniform(new THREE.Vector3()).label('rayDirection')
  };

  // Create geometry and material
  const birdGeometry = new BirdGeometry();
  const birdMaterial = new THREE.NodeMaterial();

  // Convert vertex shader to WGSL  
  const birdVertexShader = wgslFn(birdVertexWGSL);

  birdMaterial.vertexNode = birdVertexShader({
    position: attribute('position'),
    reference: attribute('reference'),
    birdVertex: attribute('birdVertex'),
    modelWorldMatrix: modelWorldMatrix,
    cameraProjectionMatrix: cameraProjectionMatrix,
    cameraViewMatrix: cameraViewMatrix
  });
  birdMaterial.side = THREE.DoubleSide;

  const birdMesh = new THREE.Mesh(birdGeometry, birdMaterial);
  birdMesh.rotation.y = Math.PI / 2;
  birdMesh.matrixAutoUpdate = false;
  birdMesh.frustumCulled = false;
  birdMesh.updateMatrix();

  // Define GPU Compute shaders
  const velocityComputeShader = wgslFn(velocityComputeWGSL);
  const positionComputeShader = wgslFn(positionComputeWGSL);

  computeVelocity = velocityComputeShader({
    index: instanceIndex,
    separation: effectController.separation,
    alignment: effectController.alignment,
    cohesion: effectController.cohesion,
    deltaTime: effectController.deltaTime,
    rayOrigin: effectController.rayOrigin,
    rayDirection: effectController.rayDirection,
    numBirds: uniform(BIRDS)
  }).compute(BIRDS);

  computePosition = positionComputeShader({
    index: instanceIndex,
    deltaTime: effectController.deltaTime
  }).compute(BIRDS);

  scene.add(birdMesh);

  // Event listeners
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('pointermove', onPointerMove);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerMove(event: PointerEvent) {
  if (event.isPrimary === false) return;

  pointer.x = (event.clientX / window.innerWidth) * 2.0 - 1.0;
  pointer.y = 1.0 - (event.clientY / window.innerHeight) * 2.0;
}

function animate() {
  render();
}

function render() {
  const now = performance.now();
  let deltaTime = (now - last) / 1000;

  if (deltaTime > 1) deltaTime = 1; // safety cap on large deltas
  last = now;

  raycaster.setFromCamera(pointer, camera);

  effectController.now.value = now;
  effectController.deltaTime.value = deltaTime;
  effectController.rayOrigin.value.copy(raycaster.ray.origin);
  effectController.rayDirection.value.copy(raycaster.ray.direction);

  renderer.compute(computeVelocity);
  renderer.compute(computePosition);
  renderer.render(scene, camera);

  // Move pointer away so we only affect birds when moving the mouse
  pointer.y = 10;
}

init();
