import * as BABYLON from 'babylonjs';
import computeShaderSource from './shaders/babylonOscilateCompute.wgsl?raw';
import matrixOrientationTestShaderSource from './shaders/matrixTestShader.wgsl?raw';
// import 'babylonjs/Engines/webgpuEngine';
// import 'babylonjs/Compute/computeShader';

export async function createWebGPUComputeScene(canvas: HTMLCanvasElement): Promise<BABYLON.WebGPUEngine> {
    // Check for WebGPU support
    if (!navigator.gpu) {
        throw new Error("WebGPU is not supported in this browser");
    }

    // Initialize WebGPU engine
    const engine = new BABYLON.WebGPUEngine(canvas);
    await engine.initAsync();

    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.1, 1);

    // Camera
    const camera = new BABYLON.ArcRotateCamera(
        "camera",
        Math.PI / 2,
        Math.PI / 2.5,
        20,
        BABYLON.Vector3.Zero(),
        scene
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 50;

    // Lighting
    const light = new BABYLON.HemisphericLight(
        "light",
        new BABYLON.Vector3(0, 1, 0),
        scene
    );
    light.intensity = 0.8;

    // Configuration
    const instanceCount = 2500;
    const gridSize = Math.ceil(Math.sqrt(instanceCount));

    // Create storage buffer for matrices
    const matrixBuffer = new BABYLON.StorageBuffer(
        engine,
        instanceCount * 16 * 4,
        BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | 
        BABYLON.Constants.BUFFER_CREATIONFLAG_STORAGE |
        BABYLON.Constants.BUFFER_CREATIONFLAG_READ
    );

    // Create uniform buffer for compute shader parameters
    const paramsBuffer = new BABYLON.UniformBuffer(engine);
    paramsBuffer.addUniform("time", 1);
    paramsBuffer.addUniform("instanceCount", 1);
    paramsBuffer.addUniform("gridSize", 1);
    paramsBuffer.updateFloat("instanceCount", instanceCount);
    paramsBuffer.updateFloat("gridSize", gridSize);
    paramsBuffer.update();

    // Store shader in ShaderStore for Babylon.js
    BABYLON.ShaderStore.ShadersStoreWGSL["oscillateCompute"] = computeShaderSource;

    // Create compute shader with proper bindings mapping
    const computeShader = new BABYLON.ComputeShader(
        "oscillate",
        engine,
        { computeSource: computeShaderSource },
        {
            bindingsMapping: {
                "matrices": { group: 0, binding: 0 },
                "params": { group: 0, binding: 1 }
            }
        }
    );

    // Set compute shader bindings
    computeShader.setStorageBuffer("matrices", matrixBuffer);
    computeShader.setUniformBuffer("params", paramsBuffer);

    // Create base mesh for instancing
    const circle = BABYLON.MeshBuilder.CreateDisc(
        "circle",
        {
            radius: 0.12,
            tessellation: 32
        },
        scene
    );

    // Create material with emissive glow
    const material = new BABYLON.StandardMaterial("mat", scene);
    material.diffuseColor = new BABYLON.Color3(0.2, 0.5, 1.0);
    material.specularColor = new BABYLON.Color3(0.2, 0.5, 1.0);
    material.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.5);
    material.specularPower = 64;
    circle.material = material;

    // Set up thin instances
    circle.thinInstanceSetBuffer("matrix", null, 16);
    circle.thinInstanceCount = instanceCount;

    // Performance monitoring
    const perfTimes: { read: number[], setBuffer: number[], frame: number[] } = { read: [], setBuffer: [], frame: [] };
    const maxSamples = 10;
    let frameCounter = 0;
    
    function addPerfSample(array: number[], value: number) {
        array.push(value);
        if (array.length > maxSamples) {
            array.shift();
        }
    }
    
    function getPerfAverage(array: number[]): number {
        if (array.length === 0) return 0;
        return array.reduce((sum, val) => sum + val, 0) / array.length;
    }

    // Create color buffer for variation
    const colors = new Float32Array(instanceCount * 4);
    for (let i = 0; i < instanceCount; i++) {
        const hue = (i / instanceCount) * 0.3 + 0.5; // Blue to cyan range
        const rgb = hslToRgb(hue, 0.8, 0.6);
        colors[i * 4] = rgb[0];
        colors[i * 4 + 1] = rgb[1];
        colors[i * 4 + 2] = rgb[2];
        colors[i * 4 + 3] = 1.0;
    }
    circle.thinInstanceSetBuffer("color", colors, 4);



    // Wait for compute shader to be ready
    while (!computeShader.isReady()) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Animation loop
    scene.registerBeforeRender(() => {
        const time = performance.now() * 0.001;

        // Update time uniform
        paramsBuffer.updateFloat("time", time);
        paramsBuffer.update();

        // Dispatch compute shader
        const workgroupCount = Math.ceil(instanceCount / 64);
        computeShader.dispatch(workgroupCount, 1, 1);

        //perfTest - start time
        const startTime = performance.now();
        
        // Read matrices directly from compute shader
        matrixBuffer.read().then((data) => {
            //perfTest - end time 1 (read time)
            const readTime = performance.now();
            const readDuration = readTime - startTime;
            addPerfSample(perfTimes.read, readDuration);
            
            const matrices = new Float32Array(data.buffer);
            circle.thinInstanceSetBuffer("matrix", matrices, 16);
            
            //perfTest - end time 2 (set buffer time)
            const setBufferTime = performance.now();
            const setBufferDuration = setBufferTime - readTime;
            addPerfSample(perfTimes.setBuffer, setBufferDuration);
            
            // Log performance every 60 frames (once we have enough samples)
            frameCounter++;
            if (frameCounter >= maxSamples && frameCounter % 60 === 0) {
                const avgRead = getPerfAverage(perfTimes.read);
                const avgSetBuffer = getPerfAverage(perfTimes.setBuffer);
                const avgFrame = getPerfAverage(perfTimes.frame);
                console.log(`GPU Performance (10-frame avg): Read: ${avgRead.toFixed(2)}ms, SetBuffer: ${avgSetBuffer.toFixed(2)}ms, Frame: ${avgFrame.toFixed(2)}ms`);
            }
        });
    });

    // Render loop
    engine.runRenderLoop(() => {
        const frameStart = performance.now();
        scene.render();
        const frameEnd = performance.now();
        const frameDuration = frameEnd - frameStart;
        addPerfSample(perfTimes.frame, frameDuration);
    });

    // Handle resize
    window.addEventListener("resize", () => {
        engine.resize();
    });
    
    return engine;
}

// Helper function for HSL to RGB conversion
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r: number, g: number, b: number;
    
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number): number => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    
    return [r, g, b];
}

async function matrixOrientationTest(engine: BABYLON.WebGPUEngine) {
    console.log("=== Matrix Orientation Test ===");
    
    const testCount = 4;
    
    // Create test compute shader
    const testShaderSource = matrixOrientationTestShaderSource;

    // Create GPU buffer
    const gpuBuffer = new BABYLON.StorageBuffer(
        engine,
        testCount * 16 * 4,
        BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | 
        BABYLON.Constants.BUFFER_CREATIONFLAG_STORAGE |
        BABYLON.Constants.BUFFER_CREATIONFLAG_READ
    );
    
    // Create params buffer
    const testParamsBuffer = new BABYLON.UniformBuffer(engine);
    testParamsBuffer.addUniform("count", 1);
    testParamsBuffer.addUniform("padding1", 1);
    testParamsBuffer.addUniform("padding2", 1);
    testParamsBuffer.addUniform("padding3", 1);
    testParamsBuffer.addUniform("padding4", 4); // vec4<f32>
    testParamsBuffer.updateFloat("count", testCount);
    testParamsBuffer.updateFloat("padding1", 0);
    testParamsBuffer.updateFloat("padding2", 0);
    testParamsBuffer.updateFloat("padding3", 0);
    testParamsBuffer.updateFloat4("padding4", 0, 0, 0, 0);
    testParamsBuffer.update();
    
    // Create compute shader
    const testComputeShader = new BABYLON.ComputeShader(
        "matrixTest",
        engine,
        { computeSource: testShaderSource },
        {
            bindingsMapping: {
                "matrices": { group: 0, binding: 0 },
                "params": { group: 0, binding: 1 }
            }
        }
    );
    
    testComputeShader.setStorageBuffer("matrices", gpuBuffer);
    testComputeShader.setUniformBuffer("params", testParamsBuffer);
    
    // Wait for shader to be ready
    while (!testComputeShader.isReady()) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    
    // Dispatch compute shader
    testComputeShader.dispatch(testCount, 1, 1);
    
    // Create CPU matrices
    const cpuMatrices = new Float32Array(testCount * 16);
    for (let i = 0; i < testCount; i++) {
        const x = i * 2.0;
        const y = i * 1.5;
        const z = i * 0.5;
        const rotationY = i * 0.5;
        const scale = 1.0 + i * 0.2;
        
        const matrix = BABYLON.Matrix.Compose(
            new BABYLON.Vector3(scale, scale, scale),
            BABYLON.Quaternion.FromEulerAngles(0, rotationY, 0),
            new BABYLON.Vector3(x, y, z)
        );
        
        matrix.copyToArray(cpuMatrices, i * 16);
    }
    
    // Read GPU matrices and compare
    const gpuData = await gpuBuffer.read();
    const gpuMatrices = new Float32Array(gpuData.buffer);
    
    let report = "=== MATRIX COMPARISON REPORT ===\n\n";
    
    for (let i = 0; i < testCount; i++) {
        const offset = i * 16;
        const x = i * 2.0;
        const y = i * 1.5;
        const z = i * 0.5;
        const rotationY = i * 0.5;
        const scale = 1.0 + i * 0.2;
        
        report += `MATRIX ${i} (pos=[${x},${y},${z}], rot=${rotationY.toFixed(3)}, scale=${scale.toFixed(3)}):\n`;
        
        // CPU matrix
        report += `CPU: [${cpuMatrices[offset].toFixed(3)}, ${cpuMatrices[offset+1].toFixed(3)}, ${cpuMatrices[offset+2].toFixed(3)}, ${cpuMatrices[offset+3].toFixed(3)}]\n`;
        report += `     [${cpuMatrices[offset+4].toFixed(3)}, ${cpuMatrices[offset+5].toFixed(3)}, ${cpuMatrices[offset+6].toFixed(3)}, ${cpuMatrices[offset+7].toFixed(3)}]\n`;
        report += `     [${cpuMatrices[offset+8].toFixed(3)}, ${cpuMatrices[offset+9].toFixed(3)}, ${cpuMatrices[offset+10].toFixed(3)}, ${cpuMatrices[offset+11].toFixed(3)}]\n`;
        report += `     [${cpuMatrices[offset+12].toFixed(3)}, ${cpuMatrices[offset+13].toFixed(3)}, ${cpuMatrices[offset+14].toFixed(3)}, ${cpuMatrices[offset+15].toFixed(3)}]\n`;
        
        // GPU matrix
        report += `GPU: [${gpuMatrices[offset].toFixed(3)}, ${gpuMatrices[offset+1].toFixed(3)}, ${gpuMatrices[offset+2].toFixed(3)}, ${gpuMatrices[offset+3].toFixed(3)}]\n`;
        report += `     [${gpuMatrices[offset+4].toFixed(3)}, ${gpuMatrices[offset+5].toFixed(3)}, ${gpuMatrices[offset+6].toFixed(3)}, ${gpuMatrices[offset+7].toFixed(3)}]\n`;
        report += `     [${gpuMatrices[offset+8].toFixed(3)}, ${gpuMatrices[offset+9].toFixed(3)}, ${gpuMatrices[offset+10].toFixed(3)}, ${gpuMatrices[offset+11].toFixed(3)}]\n`;
        report += `     [${gpuMatrices[offset+12].toFixed(3)}, ${gpuMatrices[offset+13].toFixed(3)}, ${gpuMatrices[offset+14].toFixed(3)}, ${gpuMatrices[offset+15].toFixed(3)}]\n`;
        
        // Differences for this matrix
        const diffs = [];
        for (let j = 0; j < 16; j++) {
            const diff = Math.abs(cpuMatrices[offset + j] - gpuMatrices[offset + j]);
            if (diff > 0.001) {
                diffs.push(`[${j}]: ${diff.toFixed(3)}`);
            }
        }
        if (diffs.length > 0) {
            report += `DIFFS: ${diffs.join(", ")}\n`;
        } else {
            report += `DIFFS: None significant\n`;
        }
        report += "\n";
    }
    
    let totalDiff = 0;
    for (let i = 0; i < testCount * 16; i++) {
        totalDiff += Math.abs(cpuMatrices[i] - gpuMatrices[i]);
    }
    report += `TOTAL ABSOLUTE DIFFERENCE: ${totalDiff.toFixed(6)}\n`;
    
    console.log(report);
}

export async function babylonInit() {
    // Create canvas element
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <canvas id="renderCanvas" width="1280" height="720"></canvas>
    <div id="info">
      <strong>Babylon.js 8 - WebGPU Compute Shader</strong><br>
      Oscillating Circles with Instanced Rendering
    </div>
  `;

  // Initialize the scene
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

  createWebGPUComputeScene(canvas).then(engine => {
      // Make test function available globally
      (window as any).matrixOrientationTest = () => matrixOrientationTest(engine);
      console.log("matrixOrientationTest() is now available in the console");
  }).catch(error => {
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

/**
 * Perfect! The Oracle's analysis is very insightful. Here's what's happening with your 4ms read time:

search the web and consult the oracle. this is a representative performance sample

GPU Performance (10-frame avg): Read: 3.98ms, SetBuffer: 0.64ms, Frame: 0.65ms

the read time is about 4 ms, but the frame time is less than 1 ms. is that 4 ms consequential for load on the main thread, or is it an IO wait/latency? would i be able to greatly increase the number of particles, or do many such read/write opeartions at once without too much performance impact?


Key Findings
The 4ms is GPU/driver latency, NOT main thread blocking time:

matrixBuffer.read() immediately returns a Promise and releases the JS thread
The 4ms happens on GPU/driver side during pipeline flush and memory transfer
Your main thread remains responsive during this time
However, it DOES stall the GPU pipeline:

Each readback forces a full GPU pipeline flush
Your GPU sits idle for ~3ms per frame waiting for the readback
Even though scene.render() only takes 0.65ms, the GPU can't start the next frame until readback completes
Scaling Implications
More particles: The latency will grow significantly. At 100k matrices (~6.4MB), you'd hit ~5ms+ readback time, exceeding 60fps budget.

Multiple operations: Each readback serializes (they can't run in parallel), so 2 reads = ~8ms total.

Performance Recommendations
Best solution: Keep matrices on GPU entirely

Bind the same storage buffer as vertex/instance buffer
Let vertex shader read matrices directly from compute output
Eliminates the CPU roundtrip completely
If CPU access needed: Use double-buffering

Alternate between two storage buffers
Read previous frame's data while writing current frame
Hides latency but adds 1-frame delay
Minimize readback data: Only read what CPU truly needs (particle counts, bounding boxes, etc.)

The 4ms isn't hurting your main thread, but it's the bottleneck limiting your GPU throughput and scalability.


 */