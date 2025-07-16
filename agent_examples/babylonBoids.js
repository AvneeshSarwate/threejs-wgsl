import * as BABYLON from 'babylonjs';

var createScene = function () {
    var scene = new BABYLON.Scene(engine);

    var camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2, 10, BABYLON.Vector3.Zero(), scene);

    camera.setTarget(BABYLON.Vector3.Zero());

    camera.attachControl(canvas, true);

    if (!checkComputeShadersSupported(engine, scene)) {
        return scene;
    }

    const simParams = {
        deltaT: 0.04,
        rule1Distance: 0.1,
        rule2Distance: 0.025,
        rule3Distance: 0.025,
        rule1Scale: 0.02,
        rule2Scale: 0.05,
        rule3Scale: 0.005,
    };

    const gui = getGUI();

    const updateSimParams = () => {
        boid.updateSimParams(simParams);
    };

    Object.keys(simParams).forEach((k) => {
        gui.add(simParams, k).onFinishChange(updateSimParams);
    });

    const boid = new Boid(1500, scene);

    updateSimParams();

    scene.onBeforeRenderObservable.add(() => {
        boid.update();
    });

    return scene;
};

function checkComputeShadersSupported(engine, scene) {
    const supportCS = engine.getCaps().supportComputeShaders;

    if (supportCS) {
        return true;
    }

    var panel = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI", true, scene);

    const textNOk = "**Use WebGPU to watch this demo which requires compute shaders support. To enable WebGPU please use Edge Canary or Chrome canary. Also, select the WebGPU engine from the top right drop down menu.**";

    var info = new BABYLON.GUI.TextBlock();
    info.text = textNOk;
    info.width = "100%";
    info.paddingLeft = "5px";
    info.paddingRight = "5px";
    info.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    info.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    info.color = supportCS ? "green" : "red";
    info.fontSize = supportCS ? "18px" : "24px";
    info.fontStyle = supportCS ? "" : "bold";
    info.textWrapping = true;
    panel.addControl(info); 

    return false;
}

class Boid {

    constructor(numParticles, scene) {
        const engine = scene.getEngine();

        this.numParticles = numParticles;

        // Create boid mesh
        const boidMesh = BABYLON.MeshBuilder.CreatePlane("plane", { size: 1 }, scene);

        this.mesh = boidMesh;

        boidMesh.forcedInstanceCount = numParticles;

        //const mesh = new BABYLON.Mesh("boid", scene);
        //new BABYLON.Geometry(BABYLON.Geometry.RandomId(), scene, null, false, mesh);

        const mat = new BABYLON.ShaderMaterial("mat", scene, { 
            vertexSource: boidVertexShader,
            fragmentSource: boidFragmentShader,
        }, {
            attributes: ["a_pos", "a_particlePos", "a_particleVel"]
        });

        boidMesh.material = mat;

        const buffSpriteVertex = new BABYLON.VertexBuffer(engine, [-0.01, -0.02, 0.01, -0.02, 0.0, 0.02], "a_pos", false, false, 2, false);

        boidMesh.setIndices([0, 1, 2]);
        boidMesh.setVerticesBuffer(buffSpriteVertex);

        // Create uniform / storage / vertex buffers
        this.simParams = new BABYLON.UniformBuffer(engine, undefined, undefined, "simParams");

        this.simParams.addUniform("deltaT", 1);
        this.simParams.addUniform("rule1Distance", 1);
        this.simParams.addUniform("rule2Distance", 1);
        this.simParams.addUniform("rule3Distance", 1);
        this.simParams.addUniform("rule1Scale", 1);
        this.simParams.addUniform("rule2Scale", 1);
        this.simParams.addUniform("rule3Scale", 1);
        this.simParams.addUniform("numParticles", 1);

        const initialParticleData = new Float32Array(numParticles * 4);
        for (let i = 0; i < numParticles; ++i) {
            initialParticleData[4 * i + 0] = 2 * (Math.random() - 0.5);
            initialParticleData[4 * i + 1] = 2 * (Math.random() - 0.5);
            initialParticleData[4 * i + 2] = 2 * (Math.random() - 0.5) * 0.1;
            initialParticleData[4 * i + 3] = 2 * (Math.random() - 0.5) * 0.1;
        }

        this.particleBuffers = [
            new BABYLON.StorageBuffer(engine, initialParticleData.byteLength, BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | BABYLON.Constants.BUFFER_CREATIONFLAG_WRITE),
            new BABYLON.StorageBuffer(engine, initialParticleData.byteLength, BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | BABYLON.Constants.BUFFER_CREATIONFLAG_WRITE),
        ];

        this.particleBuffers[0].update(initialParticleData);
        this.particleBuffers[1].update(initialParticleData);

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

        // Create compute shaders
        this.cs1 = new BABYLON.ComputeShader("compute1", engine, { computeSource: boidComputeShader }, {
            bindingsMapping: {
                "params": { group: 0, binding: 0 },
                "particlesA": { group: 0, binding: 1 },
                "particlesB": { group: 0, binding: 2 },
            }
        });
        this.cs1.setUniformBuffer("params", this.simParams);
        this.cs1.setStorageBuffer("particlesA", this.particleBuffers[0]);
        this.cs1.setStorageBuffer("particlesB", this.particleBuffers[1]);

        this.cs2 = new BABYLON.ComputeShader("compute2", engine, { computeSource: boidComputeShader }, {
            bindingsMapping: {
                "params": { group: 0, binding: 0 },
                "particlesA": { group: 0, binding: 1 },
                "particlesB": { group: 0, binding: 2 },
            }
        });
        this.cs2.setUniformBuffer("params", this.simParams);
        this.cs2.setStorageBuffer("particlesA", this.particleBuffers[1]);
        this.cs2.setStorageBuffer("particlesB", this.particleBuffers[0]);

        this.cs = [this.cs1, this.cs2];
        this.t = 0;
    }

    dispose() {
        this.simParams.dispose();
        this.particleBuffers[0].dispose();
        this.particleBuffers[1].dispose();
        this.cs1.dispose();
        this.cs2.dispose();
    }

    updateSimParams(simParams) {
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

    update() {
        this.cs[this.t].dispatch(Math.ceil(this.numParticles / 64));

        this.mesh.setVerticesBuffer(this.vertexBuffers[this.t][0], false);
        this.mesh.setVerticesBuffer(this.vertexBuffers[this.t][1], false);

        this.t = (this.t + 1) % 2;
    }
}

function getGUI() {
    var oldgui = document.getElementById("datGUI");
    if (oldgui != null) {
        oldgui.remove();
    }

    var gui = new dat.GUI();
    gui.domElement.style.marginTop = "100px";
    gui.domElement.id = "datGUI";

    return gui;
}

const boidVertexShader = `
    attribute vec2 a_pos;
    attribute vec2 a_particlePos;
    attribute vec2 a_particleVel;
    
    void main() {
        float angle = -atan(a_particleVel.x, a_particleVel.y);
        vec2 pos = vec2(
            a_pos.x * cos(angle) - a_pos.y * sin(angle),
            a_pos.x * sin(angle) + a_pos.y * cos(angle)
        );
        gl_Position = vec4(pos + a_particlePos, 0.0, 1.0);
    }
`;

const boidFragmentShader = `
    void main() {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
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

// https://github.com/austinEng/Project6-Vulkan-Flocking/blob/master/data/shaders/computeparticles/particle.comp
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
