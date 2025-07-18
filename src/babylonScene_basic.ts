import * as BABYLON from 'babylonjs';
import computeShaderSource from './shaders/babylonOscilateCompute.wgsl?raw';
import matrixOrientationTestShaderSource from './shaders/matrixTestShader.wgsl?raw';

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

        // Read matrices directly from compute shader
        matrixBuffer.read().then((data) => {
            const matrices = new Float32Array(data.buffer);
            circle.thinInstanceSetBuffer("matrix", matrices, 16);
        });
    });

    // Render loop
    engine.runRenderLoop(() => {
        scene.render();
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

class PerformanceMonitor {
    private readTimes: number[] = [];
    private writeTimes: number[] = [];
    private maxSamples = 10;
    private isRunning = false;
    private frameCount = 0;
    
    constructor(private engine: BABYLON.WebGPUEngine, private bufferSize: number = 2500 * 16 * 4) {}
    
    start() {
        if (this.isRunning) {
            console.log("Performance monitor already running");
            return;
        }
        
        this.isRunning = true;
        this.frameCount = 0;
        this.readTimes = [];
        this.writeTimes = [];
        
        console.log(`Starting GPU read/write performance test (buffer size: ${(this.bufferSize / 1024).toFixed(1)}KB)`);
        this.runTest();
    }
    
    stop() {
        this.isRunning = false;
        console.log("Performance monitor stopped");
    }
    
    private async runTest() {
        // Create test buffer
        const testBuffer = new BABYLON.StorageBuffer(
            this.engine,
            this.bufferSize,
            BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | 
            BABYLON.Constants.BUFFER_CREATIONFLAG_STORAGE |
            BABYLON.Constants.BUFFER_CREATIONFLAG_READ
        );
        
        // Create test data
        const testData = new Float32Array(this.bufferSize / 4);
        for (let i = 0; i < testData.length; i++) {
            testData[i] = Math.random();
        }
        
        const testLoop = async () => {
            if (!this.isRunning) return;
            
            this.frameCount++;
            
            // Test write performance (upload to GPU)
            const writeStart = performance.now();
            testBuffer.update(testData);
            const writeEnd = performance.now();
            const writeTime = writeEnd - writeStart;
            
            // Test read performance (download from GPU)
            const readStart = performance.now();
            await testBuffer.read();
            const readEnd = performance.now();
            const readTime = readEnd - readStart;
            
            // Update running averages
            this.addSample(this.readTimes, readTime);
            this.addSample(this.writeTimes, writeTime);
            
            // Log results every frame
            const readAvg = this.getAverage(this.readTimes);
            const writeAvg = this.getAverage(this.writeTimes);
            
            console.log(`Frame ${this.frameCount}: Read: ${readTime.toFixed(2)}ms (avg: ${readAvg.toFixed(2)}ms), Write: ${writeTime.toFixed(2)}ms (avg: ${writeAvg.toFixed(2)}ms)`);
            
            // Continue test
            if (this.isRunning) {
                setTimeout(testLoop, 16); // ~60fps
            }
        };
        
        testLoop();
    }
    
    private addSample(array: number[], value: number) {
        array.push(value);
        if (array.length > this.maxSamples) {
            array.shift();
        }
    }
    
    private getAverage(array: number[]): number {
        if (array.length === 0) return 0;
        return array.reduce((sum, val) => sum + val, 0) / array.length;
    }
    
    getStats() {
        return {
            readAverage: this.getAverage(this.readTimes),
            writeAverage: this.getAverage(this.writeTimes),
            frameCount: this.frameCount,
            sampleCount: Math.min(this.readTimes.length, this.maxSamples)
        };
    }
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