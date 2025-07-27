import * as BABYLON from 'babylonjs';
import computeShaderSource from './shaders/circleRotation2D.wgsl?raw';
import Stats from './stats';

export async function create2DWebGPUScene(canvas: HTMLCanvasElement, stats: Stats): Promise<BABYLON.WebGPUEngine> {
    // Check for WebGPU support
    if (!navigator.gpu) {
        throw new Error("WebGPU is not supported in this browser");
    }

    // Initialize WebGPU engine
    const engine = new BABYLON.WebGPUEngine(canvas);
    await engine.initAsync();

    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.1, 1);

    // Create orthographic camera for 2D rendering
    const camera = new BABYLON.FreeCamera("camera", new BABYLON.Vector3(0, 0, -1), scene);
    
    // Set up orthographic projection to match canvas coordinates
    const canvasWidth = 1280;
    const canvasHeight = 720;
    const aspectRatio = canvasWidth / canvasHeight;
    
    // Create orthographic matrix that maintains aspect ratio
    camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = -aspectRatio;
    camera.orthoRight = aspectRatio;
    camera.orthoTop = 1;
    camera.orthoBottom = -1;
    camera.minZ = 0.1;
    camera.maxZ = 100;

    // Configuration
    const instanceCount = 32; // Number of circles rotating around the main circle
    const centerX = canvasWidth / 2;  // Center of canvas
    const centerY = canvasHeight / 2;
    const radius = 200; // Radius of the main circle in pixels

    // Create storage buffer for matrices - 64 bytes per instance (4 vec4 columns)
    const matrixBuffer = new BABYLON.StorageBuffer(
        engine,
        instanceCount * 64, // 64 bytes per instance (4 vec4 = 16 floats)
        BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | 
        BABYLON.Constants.BUFFER_CREATIONFLAG_STORAGE
    );

    // Create uniform buffer for compute shader parameters
    const paramsBuffer = new BABYLON.UniformBuffer(engine);
    paramsBuffer.addUniform("time", 1);
    paramsBuffer.addUniform("instanceCount", 1);
    paramsBuffer.addUniform("centerX", 1);
    paramsBuffer.addUniform("centerY", 1);
    paramsBuffer.addUniform("radius", 1);
    paramsBuffer.addUniform("canvasWidth", 1);
    paramsBuffer.addUniform("canvasHeight", 1);
    
    paramsBuffer.updateFloat("instanceCount", instanceCount);
    paramsBuffer.updateFloat("centerX", centerX);
    paramsBuffer.updateFloat("centerY", centerY);
    paramsBuffer.updateFloat("radius", radius);
    paramsBuffer.updateFloat("canvasWidth", canvasWidth);
    paramsBuffer.updateFloat("canvasHeight", canvasHeight);
    paramsBuffer.update();

    // Store shader in ShaderStore for Babylon.js
    BABYLON.ShaderStore.ShadersStoreWGSL["circleRotation2D"] = computeShaderSource;

    // Create compute shader with proper bindings mapping
    const computeShader = new BABYLON.ComputeShader(
        "circleRotation2D",
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

    // Create base mesh for instancing (2D circle)
    // Calculate appropriate radius for the orthographic coordinate system
    // Target: ~40 pixel diameter circles on 1280x720 canvas
    const targetPixelSize = 10;
    const orthoWidth = 2 * aspectRatio; // Total orthographic width
    const circleRadius = (targetPixelSize / canvasWidth) * orthoWidth * 0.5;
    
    const circle = BABYLON.MeshBuilder.CreateDisc(
        "circle",
        {
            radius: circleRadius,
            tessellation: 16
        },
        scene
    );

    // Create material
    const material = new BABYLON.StandardMaterial("mat", scene);
    material.diffuseColor = new BABYLON.Color3(1.0, 0.5, 0.2);
    material.emissiveColor = new BABYLON.Color3(0.3, 0.1, 0.05);
    material.disableLighting = true; // For 2D we don't need lighting
    circle.material = material;

    // Set up thin instances - declare the matrix buffer but don't populate it
    circle.thinInstanceSetBuffer("matrix", null, 16);
    circle.thinInstanceCount = instanceCount;
    circle.forcedInstanceCount = instanceCount;
    
    // Enable manual control of world matrix buffer
    circle.manualUpdateOfWorldMatrixInstancedBuffer = true;
    
    // Set up four instanced vertex buffers (world0-world3) pointing to the same GPU buffer
    const strideFloats = 16;  // 16 floats per instance (64 bytes)
    const vsize = 4;          // 4 floats per attribute (vec4)
    
    const world0 = new BABYLON.VertexBuffer(
        engine,
        matrixBuffer.getBuffer(),
        "world0",
        false, false, strideFloats, true, 0, vsize
    );
    
    const world1 = new BABYLON.VertexBuffer(
        engine,
        matrixBuffer.getBuffer(),
        "world1",
        false, false, strideFloats, true, 4, vsize
    );
    
    const world2 = new BABYLON.VertexBuffer(
        engine,
        matrixBuffer.getBuffer(),
        "world2",
        false, false, strideFloats, true, 8, vsize
    );
    
    const world3 = new BABYLON.VertexBuffer(
        engine,
        matrixBuffer.getBuffer(),
        "world3",
        false, false, strideFloats, true, 12, vsize
    );
    
    // Attach the vertex buffers to the mesh
    circle.setVerticesBuffer(world0);
    circle.setVerticesBuffer(world1);
    circle.setVerticesBuffer(world2);
    circle.setVerticesBuffer(world3);

    // Create color buffer for variation
    const colors = new Float32Array(instanceCount * 4);
    for (let i = 0; i < instanceCount; i++) {
        const hue = (i / instanceCount) * 360;
        const rgb = hslToRgb(hue / 360, 0.8, 0.6);
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
    });

    // Render loop
    engine.runRenderLoop(() => {
        stats.begin();
        scene.render();
        stats.end();
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

export async function babylon2DInit() {
    //@ts-expect-error
    const stats = new Stats();
  
    stats.showPanel(0);
    document.body.appendChild(stats.dom);

    // Create canvas element
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = `
        <canvas id="renderCanvas" width="1280" height="720"></canvas>
        <div id="info">
            <strong>Babylon.js 2D - WebGPU Compute Shader</strong><br>
            Circles rotating around a circle in 2D space
        </div>
    `;

    // Initialize the scene
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

    create2DWebGPUScene(canvas, stats).catch(error => {
        console.error('Failed to initialize WebGPU 2D scene:', error);
        
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
