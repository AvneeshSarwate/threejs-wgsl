import * as BABYLON from 'babylonjs';

export async function createWebGPUComputeScene(canvas: HTMLCanvasElement): Promise<void> {
    // Check for WebGPU support
    if (!navigator.gpu) {
        throw new Error("WebGPU is not supported in this browser");
    }

    // Initialize WebGPU engine
    const engine = new BABYLON.WebGPUEngine(canvas);
    await engine.initAsync();

    if (!engine.getCaps().supportComputeShaders) {
        throw new Error("Compute shaders are not supported");
    }

    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.1, 1);

    // Camera
    const camera = new BABYLON.ArcRotateCamera(
        "camera",
        -Math.PI / 2,
        Math.PI / 2,
        10,
        BABYLON.Vector3.Zero(),
        scene
    );
    camera.setTarget(BABYLON.Vector3.Zero());
    camera.attachControl(canvas, true);

    // Configuration
    const numParticles = 1500;

    // Initialize boids simulation
    const boid = new Boid(numParticles, scene, engine);

    // Simulation parameters
    const simParams = {
        deltaT: 0.04,
        rule1Distance: 0.1,
        rule2Distance: 0.025,
        rule3Distance: 0.025,
        rule1Scale: 0.02,
        rule2Scale: 0.05,
        rule3Scale: 0.005,
    };

    boid.updateSimParams(simParams);

    // Animation loop
    scene.onBeforeRenderObservable.add(() => {
        boid.update();
    });

    // Render loop
    engine.runRenderLoop(() => {
        scene.render();
    });

    // Handle resize
    window.addEventListener("resize", () => {
        engine.resize();
    });
}

class Boid {
    private mesh: BABYLON.Mesh;
    private numParticles: number;
    private simParams: BABYLON.UniformBuffer;
    private particleBuffers: BABYLON.StorageBuffer[];
    private vertexBuffers: BABYLON.VertexBuffer[][];
    private cs: BABYLON.ComputeShader[];
    private t: number = 0;

    constructor(numParticles: number, scene: BABYLON.Scene, engine: BABYLON.WebGPUEngine) {
        this.numParticles = numParticles;

        // Create circle mesh instead of triangle
        const circle = BABYLON.MeshBuilder.CreateDisc(
            "circle",
            {
                radius: 0.1,
                tessellation: 16
            },
            scene
        );

        this.mesh = circle;
        circle.forcedInstanceCount = numParticles;

        // Create custom shader material
        const mat = new BABYLON.ShaderMaterial("mat", scene, {
            vertexSource: boidVertexShader,
            fragmentSource: boidFragmentShader,
        }, {
            attributes: ["position", "a_particlePos", "a_particleVel"]
        });

        circle.material = mat;

        // Create uniform buffer for simulation parameters
        this.simParams = new BABYLON.UniformBuffer(engine, undefined, undefined, "simParams");
        this.simParams.addUniform("deltaT", 1);
        this.simParams.addUniform("rule1Distance", 1);
        this.simParams.addUniform("rule2Distance", 1);
        this.simParams.addUniform("rule3Distance", 1);
        this.simParams.addUniform("rule1Scale", 1);
        this.simParams.addUniform("rule2Scale", 1);
        this.simParams.addUniform("rule3Scale", 1);
        this.simParams.addUniform("numParticles", 1);

        // Initialize particle data
        const initialParticleData = new Float32Array(numParticles * 4);
        for (let i = 0; i < numParticles; ++i) {
            initialParticleData[4 * i + 0] = 2 * (Math.random() - 0.5);
            initialParticleData[4 * i + 1] = 2 * (Math.random() - 0.5);
            initialParticleData[4 * i + 2] = 2 * (Math.random() - 0.5) * 0.1;
            initialParticleData[4 * i + 3] = 2 * (Math.random() - 0.5) * 0.1;
        }

        // Create double-buffered storage buffers for ping-pong
        this.particleBuffers = [
            new BABYLON.StorageBuffer(engine, initialParticleData.byteLength, BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | BABYLON.Constants.BUFFER_CREATIONFLAG_WRITE),
            new BABYLON.StorageBuffer(engine, initialParticleData.byteLength, BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | BABYLON.Constants.BUFFER_CREATIONFLAG_WRITE),
        ];

        this.particleBuffers[0].update(initialParticleData);
        this.particleBuffers[1].update(initialParticleData);

        // Create vertex buffers that directly reference storage buffer memory
        this.vertexBuffers = [
            [
                new BABYLON.VertexBuffer(engine, this.particleBuffers[0].getBuffer(), "a_particlePos", false, false, 4, true, 0, 2),
                new BABYLON.VertexBuffer(engine, this.particleBuffers[0].getBuffer(), "a_particleVel", false, false, 4, true, 2, 2)
            ],
            [
                new BABYLON.VertexBuffer(engine, this.particleBuffers[1].getBuffer(), "a_particlePos", false, false, 4, true, 0, 2),
                new BABYLON.VertexBuffer(engine, this.particleBuffers[1].getBuffer(), "a_particleVel", false, false, 4, true, 2, 2)
            ]
        ];

        // Create compute shaders for ping-pong
        const cs1 = new BABYLON.ComputeShader("compute1", engine, { computeSource: boidComputeShader }, {
            bindingsMapping: {
                "params": { group: 0, binding: 0 },
                "particlesA": { group: 0, binding: 1 },
                "particlesB": { group: 0, binding: 2 },
            }
        });
        cs1.setUniformBuffer("params", this.simParams);
        cs1.setStorageBuffer("particlesA", this.particleBuffers[0]);
        cs1.setStorageBuffer("particlesB", this.particleBuffers[1]);

        const cs2 = new BABYLON.ComputeShader("compute2", engine, { computeSource: boidComputeShader }, {
            bindingsMapping: {
                "params": { group: 0, binding: 0 },
                "particlesA": { group: 0, binding: 1 },
                "particlesB": { group: 0, binding: 2 },
            }
        });
        cs2.setUniformBuffer("params", this.simParams);
        cs2.setStorageBuffer("particlesA", this.particleBuffers[1]);
        cs2.setStorageBuffer("particlesB", this.particleBuffers[0]);

        this.cs = [cs1, cs2];
    }

    dispose(): void {
        this.simParams.dispose();
        this.particleBuffers[0].dispose();
        this.particleBuffers[1].dispose();
    }

    updateSimParams(simParams: any): void {
        this.simParams.updateFloat("deltaT", simParams.deltaT);
        this.simParams.updateFloat("rule1Distance", simParams.rule1Distance);
        this.simParams.updateFloat("rule2Distance", simParams.rule2Distance);
        this.simParams.updateFloat("rule3Distance", simParams.rule3Distance);
        this.simParams.updateFloat("rule1Scale", simParams.rule1Scale);
        this.simParams.updateFloat("rule2Scale", simParams.rule2Scale);
        this.simParams.updateFloat("rule3Scale", simParams.rule3Scale);
        this.simParams.updateInt("numParticles", this.numParticles);
        this.simParams.update();
    }

    update(): void {
        // Dispatch compute shader
        this.cs[this.t].dispatch(Math.ceil(this.numParticles / 64));

        // Update vertex buffers to point to current buffer (GPU-to-GPU)
        this.mesh.setVerticesBuffer(this.vertexBuffers[this.t][0], false);
        this.mesh.setVerticesBuffer(this.vertexBuffers[this.t][1], false);

        // Ping-pong buffers
        this.t = (this.t + 1) % 2;
    }
}

const boidVertexShader = `
    attribute vec3 position;
    attribute vec2 a_particlePos;
    attribute vec2 a_particleVel;
    
    uniform mat4 worldViewProjection;
    
    void main() {
        // Calculate rotation angle based on velocity
        float angle = -atan(a_particleVel.x, a_particleVel.y);
        
        // Apply rotation to circle vertices
        vec2 rotatedPos = vec2(
            position.x * cos(angle) - position.y * sin(angle),
            position.y * sin(angle) + position.x * cos(angle)
        );
        
        // Scale and translate
        vec2 worldPos = rotatedPos * 0.1 + a_particlePos;
        
        gl_Position = worldViewProjection * vec4(worldPos, 0.0, 1.0);
    }
`;

const boidFragmentShader = `
    void main() {
        gl_FragColor = vec4(0.2, 0.5, 1.0, 1.0);
    }
`;

const boidComputeShader = `
struct Particle {
  pos : vec2<f32>,
  vel : vec2<f32>,
};

struct SimParams {
  deltaT : f32,
  rule1Distance : f32,
  rule2Distance : f32,
  rule3Distance : f32,
  rule1Scale : f32,
  rule2Scale : f32,
  rule3Scale : f32,
  numParticles: u32,
};

struct Particles {
  particles : array<Particle>,
};

@binding(0) @group(0) var<uniform> params : SimParams;
@binding(1) @group(0) var<storage, read> particlesA : Particles;
@binding(2) @group(0) var<storage, read_write> particlesB : Particles;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  var index : u32 = GlobalInvocationID.x;

  if (index >= params.numParticles) {
      return;
  }

  var vPos : vec2<f32> = particlesA.particles[index].pos;
  var vVel : vec2<f32> = particlesA.particles[index].vel;
  var cMass : vec2<f32> = vec2<f32>(0.0, 0.0);
  var cVel : vec2<f32> = vec2<f32>(0.0, 0.0);
  var colVel : vec2<f32> = vec2<f32>(0.0, 0.0);
  var cMassCount : u32 = 0u;
  var cVelCount : u32 = 0u;
  var pos : vec2<f32>;
  var vel : vec2<f32>;

  for (var i : u32 = 0u; i < arrayLength(&particlesA.particles); i = i + 1u) {
    if (i == index) {
      continue;
    }

    pos = particlesA.particles[i].pos.xy;
    vel = particlesA.particles[i].vel.xy;
    if (distance(pos, vPos) < params.rule1Distance) {
      cMass = cMass + pos;
      cMassCount = cMassCount + 1u;
    }
    if (distance(pos, vPos) < params.rule2Distance) {
      colVel = colVel - (pos - vPos);
    }
    if (distance(pos, vPos) < params.rule3Distance) {
      cVel = cVel + vel;
      cVelCount = cVelCount + 1u;
    }
  }
  if (cMassCount > 0u) {
    var temp : f32 = f32(cMassCount);
    cMass = (cMass / vec2<f32>(temp, temp)) - vPos;
  }
  if (cVelCount > 0u) {
    var temp : f32 = f32(cVelCount);
    cVel = cVel / vec2<f32>(temp, temp);
  }
  vVel = vVel + (cMass * params.rule1Scale) + (colVel * params.rule2Scale) +
      (cVel * params.rule3Scale);

  // clamp velocity for a more pleasing simulation
  vVel = normalize(vVel) * clamp(length(vVel), 0.0, 0.1);
  // kinematic update
  vPos = vPos + (vVel * params.deltaT);
  // Wrap around boundary
  if (vPos.x < -1.0) {
    vPos.x = 1.0;
  }
  if (vPos.x > 1.0) {
    vPos.x = -1.0;
  }
  if (vPos.y < -1.0) {
    vPos.y = 1.0;
  }
  if (vPos.y > 1.0) {
    vPos.y = -1.0;
  }
  // Write back
  particlesB.particles[index].pos = vPos;
  particlesB.particles[index].vel = vVel;
}
`;

export async function babylonBoidsInit() {
    // Create canvas element
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = `
        <canvas id="renderCanvas" width="1280" height="720"></canvas>
        <div id="info">
            <strong>Babylon.js 8 - WebGPU Boids Simulation</strong><br>
            Efficient GPU-to-GPU Flocking with Circle Geometry
        </div>
    `;

    // Initialize the scene
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

    createWebGPUComputeScene(canvas).catch(error => {
        console.error('Failed to initialize WebGPU scene:', error);
        
        const infoElement = document.getElementById('info');
        if (infoElement) {
            if (!navigator.gpu) {
                infoElement.innerHTML = `
                    <span class="error">WebGPU is not available!</span><br>
                    This could be due to:<br>
                    • Browser doesn't support WebGPU<br>
                    • WebGPU is disabled in browser settings<br><br>
                    Try: Chrome/Edge 113+ or Safari Technology Preview
                `;
            } else {
                infoElement.innerHTML = `
                    <span class="error">WebGPU initialization failed!</span><br>
                    ${error.message}
                `;
            }
        }
    });
}