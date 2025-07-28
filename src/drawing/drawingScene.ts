import * as BABYLON from 'babylonjs';
import { StrokeDataGenerator } from './strokeDataGenerator';
import { StrokeInterpolator } from './strokeInterpolator';
import { StrokeTextureManager } from './strokeTextureManager';
import { DrawLifecycleManager } from './drawLifecycleManager';
import { DRAWING_CONSTANTS } from './constants';
import strokeAnimationWGSL from '../shaders/strokeAnimation.wgsl?raw';
import Stats from '../stats';

export class DrawingScene {
  private engine!: BABYLON.WebGPUEngine;
  private scene!: BABYLON.Scene;
  private strokeTextureManager!: StrokeTextureManager;
  private lifecycleManager!: DrawLifecycleManager;
  private computeShader!: BABYLON.ComputeShader;
  private instancedMesh!: BABYLON.Mesh;
  private matrixBuffer!: BABYLON.StorageBuffer;
  private globalParamsBuffer!: BABYLON.UniformBuffer;
  private maxAnimations: number = DRAWING_CONSTANTS.MAX_ANIMATIONS;
  private pointsPerStroke: number = DRAWING_CONSTANTS.POINTS_PER_STROKE;
  private maxInstances: number = this.maxAnimations * this.pointsPerStroke;
  
  async createScene(canvas: HTMLCanvasElement, stats: Stats): Promise<void> {
    await this.initializeEngine(canvas);
    this.setupCamera();
    await this.setupStrokeData();
    this.setupMaterials();
    await this.setupComputeShader();
    this.setupInteraction();
    this.startRenderLoop(stats);
  }
  
  private async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    // Check for WebGPU support
    if (!navigator.gpu) {
      throw new Error("WebGPU is not supported in this browser");
    }
    
    // Initialize WebGPU engine
    this.engine = new BABYLON.WebGPUEngine(canvas);
    await this.engine.initAsync();
    
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.1, 1);
    
    // Initialize managers
    this.strokeTextureManager = new StrokeTextureManager(this.engine);
    this.lifecycleManager = new DrawLifecycleManager(this.engine, this.strokeTextureManager);
  }
  
  private setupCamera(): void {
    // Create orthographic camera for 2D rendering
    const camera = new BABYLON.FreeCamera("camera", new BABYLON.Vector3(0, 0, -1), this.scene);
    
    // Set up orthographic projection to match canvas coordinates
    const aspectRatio = DRAWING_CONSTANTS.CANVAS_WIDTH / DRAWING_CONSTANTS.CANVAS_HEIGHT;
    
    camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = -aspectRatio;
    camera.orthoRight = aspectRatio;
    camera.orthoTop = 1;
    camera.orthoBottom = -1;
    camera.minZ = 0.1;
    camera.maxZ = 100;
  }
  
  private async setupStrokeData(): Promise<void> {
    // Generate test strokes
    const generator = new StrokeDataGenerator();
    const interpolator = new StrokeInterpolator();
    
    const testStrokes = generator.generateTestStrokes();
    
    // Normalize and upload to GPU
    const normalizedStrokes = testStrokes.slice(0, DRAWING_CONSTANTS.MAX_STROKES).map((stroke, index) => {
      const normalizedPoints = interpolator.normalizeStroke(stroke);
      
      // Validate normalized stroke
      if (!interpolator.validateNormalizedStroke(normalizedPoints)) {
        throw new Error(`Failed to normalize stroke ${stroke.id}`);
      }
      
      // Create normalized stroke object with original bounding box
      const normalizedStroke = {
        ...stroke,
        points: normalizedPoints
      };
      
      return {
        index,
        stroke: normalizedStroke
      };
    });
    
    this.strokeTextureManager.uploadStrokes(normalizedStrokes);
    
    console.log(`Uploaded ${normalizedStrokes.length} test strokes to GPU`);
  }
  
  private setupMaterials(): void {
    // Create base mesh for instancing (2D circle)
    const aspectRatio = DRAWING_CONSTANTS.CANVAS_WIDTH / DRAWING_CONSTANTS.CANVAS_HEIGHT;
    const targetPixelSize = 50; // Larger base size for visibility
    const orthoWidth = 2 * aspectRatio;
    const circleRadius = (targetPixelSize / DRAWING_CONSTANTS.CANVAS_WIDTH) * orthoWidth * 0.5;
    
    this.instancedMesh = BABYLON.MeshBuilder.CreateDisc(
      "strokePoint",
      {
        radius: circleRadius,
        tessellation: 8 // Simple circles for performance
      },
      this.scene
    );
    
    // Create material
    const material = new BABYLON.StandardMaterial("strokeMaterial", this.scene);
    material.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0); // White color
    material.emissiveColor = new BABYLON.Color3(1.0, 1.0, 1.0); // White emissive for visibility
    material.disableLighting = true; // For 2D we don't need lighting
    this.instancedMesh.material = material;
    
    // Set up instancing
    this.instancedMesh.thinInstanceCount = this.maxInstances;
    this.instancedMesh.forcedInstanceCount = this.maxInstances;
    this.instancedMesh.manualUpdateOfWorldMatrixInstancedBuffer = true;
    
    // Create matrix buffer for instances
    this.matrixBuffer = new BABYLON.StorageBuffer(
      this.engine,
      this.maxInstances * DRAWING_CONSTANTS.MATRIX_SIZE,
      BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | 
      BABYLON.Constants.BUFFER_CREATIONFLAG_STORAGE |
      BABYLON.Constants.BUFFER_CREATIONFLAG_WRITE
    );
    
    // Set up vertex buffers for world matrix
    this.setupInstancedVertexBuffers();
  }
  
  private setupInstancedVertexBuffers(): void {
    const strideFloats = 16;  // 16 floats per instance (64 bytes)
    const vsize = 4;          // 4 floats per attribute (vec4)
    
    const world0 = new BABYLON.VertexBuffer(
      this.engine,
      this.matrixBuffer.getBuffer(),
      "world0",
      false, false, strideFloats, true, 0, vsize
    );
    
    const world1 = new BABYLON.VertexBuffer(
      this.engine,
      this.matrixBuffer.getBuffer(),
      "world1",
      false, false, strideFloats, true, 4, vsize
    );
    
    const world2 = new BABYLON.VertexBuffer(
      this.engine,
      this.matrixBuffer.getBuffer(),
      "world2",
      false, false, strideFloats, true, 8, vsize
    );
    
    const world3 = new BABYLON.VertexBuffer(
      this.engine,
      this.matrixBuffer.getBuffer(),
      "world3",
      false, false, strideFloats, true, 12, vsize
    );
    
    // Attach vertex buffers to mesh
    this.instancedMesh.setVerticesBuffer(world0);
    this.instancedMesh.setVerticesBuffer(world1);
    this.instancedMesh.setVerticesBuffer(world2);
    this.instancedMesh.setVerticesBuffer(world3);
  }
  
  private async setupComputeShader(): Promise<void> {
    // Create global parameters uniform buffer
    this.globalParamsBuffer = new BABYLON.UniformBuffer(this.engine);
    this.globalParamsBuffer.addUniform("time", 1);
    this.globalParamsBuffer.addUniform("canvasWidth", 1);
    this.globalParamsBuffer.addUniform("canvasHeight", 1);
    this.globalParamsBuffer.addUniform("maxAnimations", 1);
    this.globalParamsBuffer.addUniform("deltaTime", 1);
    this.globalParamsBuffer.addUniform("padding1", 1);
    this.globalParamsBuffer.addUniform("padding2", 1);
    this.globalParamsBuffer.addUniform("padding3", 1);
    
    // Set initial values
    this.globalParamsBuffer.updateFloat("canvasWidth", DRAWING_CONSTANTS.CANVAS_WIDTH);
    this.globalParamsBuffer.updateFloat("canvasHeight", DRAWING_CONSTANTS.CANVAS_HEIGHT);
    this.globalParamsBuffer.updateFloat("maxAnimations", this.maxAnimations);
    this.globalParamsBuffer.update();
    
    // Store shader in ShaderStore
    BABYLON.ShaderStore.ShadersStoreWGSL["strokeAnimation"] = strokeAnimationWGSL;
    
    // Create compute shader
    this.computeShader = new BABYLON.ComputeShader(
      "strokeAnimation",
      this.engine,
      { computeSource: strokeAnimationWGSL },
      {
        bindingsMapping: {
          "instanceMatrices": { group: 0, binding: 0 },
          "launchConfigs": { group: 0, binding: 1 },
          "globalParams": { group: 0, binding: 2 },
          "strokeTexture": { group: 0, binding: 3 },
          "strokeSampler": { group: 0, binding: 4 }
        }
      }
    );
    
    // Bind resources
    this.computeShader.setStorageBuffer("instanceMatrices", this.matrixBuffer);
    this.computeShader.setStorageBuffer("launchConfigs", this.lifecycleManager.getGPUBuffer());
    this.computeShader.setUniformBuffer("globalParams", this.globalParamsBuffer);
    this.computeShader.setTexture("strokeTexture", this.strokeTextureManager.getStrokeTexture(), false);
    this.computeShader.setTextureSampler("strokeSampler", new BABYLON.TextureSampler());
    
    // Wait for shader to be ready
    while (!this.computeShader.isReady()) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    
    console.log("Compute shader initialized successfully");
  }
  
  private setupInteraction(): void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) return;
    
    canvas.addEventListener('click', (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      // Get parameters from UI controls, with fallbacks
      const strokeA = parseInt((document.getElementById('strokeA') as HTMLInputElement)?.value || '0');
      const strokeB = parseInt((document.getElementById('strokeB') as HTMLInputElement)?.value || '1');
      const interpolationT = parseFloat((document.getElementById('interp') as HTMLInputElement)?.value || '0.5');
      const duration = parseFloat((document.getElementById('duration') as HTMLInputElement)?.value || '2.0');
      const scale = parseFloat((document.getElementById('scale') as HTMLInputElement)?.value || '1.0');
      const position = (document.getElementById('position') as HTMLSelectElement)?.value || 'center';
      
      try {
        const animId = this.lifecycleManager.launchFromMouseClick(x, y, strokeA, strokeB, {
          interpolationT,
          duration,
          scale,
          position: position as 'start' | 'center' | 'end'
        });
        
        console.log(`Launched animation ${animId} at (${x}, ${y}) - A:${strokeA} B:${strokeB} t:${interpolationT} dur:${duration}s scale:${scale}`);
      } catch (error) {
        console.warn("Failed to launch animation:", error);
      }
    });
    
    // Add debug button functionality
    const debugButton = document.getElementById('debugDraw') as HTMLButtonElement;
    if (debugButton) {
      debugButton.addEventListener('click', () => {
        this.drawDebugTexture();
      });
    }
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (event) => {
      switch (event.key) {
        case 'c':
        case 'C':
          this.lifecycleManager.clearAll();
          console.log("Cleared all animations");
          break;
      }
    });
  }
  
  private drawDebugTexture(): void {
    const debugCanvas = document.getElementById('debugCanvasElement') as HTMLCanvasElement;
    if (!debugCanvas) {
      console.warn("Debug canvas not found");
      return;
    }
    
    const ctx = debugCanvas.getContext('2d');
    if (!ctx) {
      console.warn("Could not get 2D context for debug canvas");
      return;
    }
    
    // Clear canvas with white background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, debugCanvas.width, debugCanvas.height);
    
    // Get current UI parameters for stroke interpolation
    const strokeA = parseInt((document.getElementById('strokeA') as HTMLInputElement)?.value || '0');
    const strokeB = parseInt((document.getElementById('strokeB') as HTMLInputElement)?.value || '1');
    const interpolationT = parseFloat((document.getElementById('interp') as HTMLInputElement)?.value || '0.5');
    const position = (document.getElementById('position') as HTMLSelectElement)?.value || 'center';
    
    // Get stroke data
    const pointsA = this.strokeTextureManager.getStrokeData(strokeA);
    const pointsB = this.strokeTextureManager.getStrokeData(strokeB);
    
    // Check if strokes have data
    const hasDataA = pointsA.some((p: {x: number, y: number}) => p.x !== 0 || p.y !== 0);
    const hasDataB = pointsB.some((p: {x: number, y: number}) => p.x !== 0 || p.y !== 0);
    
    if (!hasDataA && !hasDataB) {
      ctx.fillStyle = 'red';
      ctx.font = '14px Arial';
      ctx.fillText('No stroke data found', 10, 30);
      return;
    }
    
    // Draw stroke A in gray
    if (hasDataA) {
      ctx.strokeStyle = '#888';
      ctx.fillStyle = '#888';
      ctx.lineWidth = 1;
      
      ctx.beginPath();
      let firstPoint = true;
      
      for (let i = 0; i < pointsA.length; i++) {
        const point = pointsA[i];
        if (point.x === 0 && point.y === 0) continue;
        
        // Map from canvas coordinates (0-1280, 0-720) to debug canvas size (512x256)
        const canvasX = (point.x / 1280) * debugCanvas.width;
        const canvasY = (point.y / 720) * debugCanvas.height;
        
        if (firstPoint) {
          ctx.moveTo(canvasX, canvasY);
          firstPoint = false;
        } else {
          ctx.lineTo(canvasX, canvasY);
        }
        
        ctx.fillRect(canvasX - 0.5, canvasY - 0.5, 1, 1);
      }
      
      ctx.stroke();
      
      ctx.fillStyle = '#888';
      ctx.font = '12px Arial';
      ctx.fillText(`Stroke A (${strokeA})`, 10, 20);
    }
    
    // Draw stroke B in light gray
    if (hasDataB) {
      ctx.strokeStyle = '#ccc';
      ctx.fillStyle = '#ccc';
      ctx.lineWidth = 1;
      
      ctx.beginPath();
      let firstPoint = true;
      
      for (let i = 0; i < pointsB.length; i++) {
        const point = pointsB[i];
        if (point.x === 0 && point.y === 0) continue;
        
        // Map from canvas coordinates (0-1280, 0-720) to debug canvas size (512x256)
        const canvasX = (point.x / 1280) * debugCanvas.width;
        const canvasY = (point.y / 720) * debugCanvas.height;
        
        if (firstPoint) {
          ctx.moveTo(canvasX, canvasY);
          firstPoint = false;
        } else {
          ctx.lineTo(canvasX, canvasY);
        }
        
        ctx.fillRect(canvasX - 0.5, canvasY - 0.5, 1, 1);
      }
      
      ctx.stroke();
      
      ctx.fillStyle = '#ccc';
      ctx.font = '12px Arial';
      ctx.fillText(`Stroke B (${strokeB})`, 10, 40);
    }
    
    // Draw interpolated stroke in black (bold)
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    let firstPoint = true;
    
    for (let i = 0; i < Math.min(pointsA.length, pointsB.length); i++) {
      const pointA = pointsA[i];
      const pointB = pointsB[i];
      
      // Skip if both points are zero
      if ((pointA.x === 0 && pointA.y === 0) && (pointB.x === 0 && pointB.y === 0)) continue;
      
      // Interpolate between A and B
      const interpX = pointA.x * (1 - interpolationT) + pointB.x * interpolationT;
      const interpY = pointA.y * (1 - interpolationT) + pointB.y * interpolationT;
      
      // Map from canvas coordinates (0-1280, 0-720) to debug canvas size (512x256)
      const canvasX = (interpX / 1280) * debugCanvas.width + 300;
      const canvasY = (interpY / 720) * debugCanvas.height + 150;
      
      if (firstPoint) {
        ctx.moveTo(canvasX, canvasY);
        firstPoint = false;
      } else {
        ctx.lineTo(canvasX, canvasY);
      }
      
      // Draw larger dots for interpolated points
      ctx.fillRect(canvasX - 1, canvasY - 1, 2, 2);
    }
    
    ctx.stroke();
    
    // Label the interpolated stroke
    ctx.fillStyle = 'black';
    ctx.font = '14px Arial';
    ctx.fillText(`Interpolated (t=${interpolationT.toFixed(2)})`, 10, 60);
    
    // Debug: Print actual coordinate ranges
    console.log("=== STROKE DATA DEBUG ===");
    console.log(`Stroke A (${strokeA}):`, pointsA.slice(0, 5)); // First 5 points
    console.log(`Stroke B (${strokeB}):`, pointsB.slice(0, 5)); // First 5 points
    
    // Check coordinate ranges
    const rangeA = { 
      minX: Math.min(...pointsA.map(p => p.x)), 
      maxX: Math.max(...pointsA.map(p => p.x)),
      minY: Math.min(...pointsA.map(p => p.y)), 
      maxY: Math.max(...pointsA.map(p => p.y))
    };
    const rangeB = { 
      minX: Math.min(...pointsB.map(p => p.x)), 
      maxX: Math.max(...pointsB.map(p => p.x)),
      minY: Math.min(...pointsB.map(p => p.y)), 
      maxY: Math.max(...pointsB.map(p => p.y))
    };
    
    console.log("Stroke A ranges:", rangeA);
    console.log("Stroke B ranges:", rangeB);
    console.log("Y variation A:", rangeA.maxY - rangeA.minY);
    console.log("Y variation B:", rangeB.maxY - rangeB.minY);
    console.log("========================");
  }
  
  private startRenderLoop(stats: Stats): void {
    let lastTime = performance.now() * 0.001;
    
    this.scene.registerBeforeRender(() => {
      const currentTime = performance.now() * 0.001;
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;
      
      // Update animation lifecycle
      this.lifecycleManager.tick(currentTime);
      
      // Update global parameters
      this.globalParamsBuffer.updateFloat("time", currentTime);
      this.globalParamsBuffer.updateFloat("deltaTime", deltaTime);
      this.globalParamsBuffer.update();
      
      // Dispatch compute shader with optimized 1D layout
      const totalThreads = this.maxAnimations * this.pointsPerStroke;
      const workgroupSize = DRAWING_CONSTANTS.WORKGROUP_SIZE;
      const workgroups = Math.ceil(totalThreads / workgroupSize);
      this.computeShader.dispatch(workgroups, 1, 1);
      
      // Debug: Log active animations every few seconds
      if (Math.floor(currentTime) % 3 === 0 && deltaTime < 0.1) {
        const status = this.lifecycleManager.getStatus();
        if (status.activeCount > 0) {
          console.log(`Active animations: ${status.activeCount}, dispatching ${workgroups} workgroups (${totalThreads} threads)`);
        }
      }
    });
    
    this.engine.runRenderLoop(() => {
      stats.begin();
      this.scene.render();
      stats.end();
    });
    
    // Handle resize
    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }
  
  /**
   * Get system status for debugging
   */
  getStatus(): {
    animations: ReturnType<DrawLifecycleManager['getStatus']>;
    memory: ReturnType<StrokeTextureManager['getMemoryInfo']>;
  } {
    return {
      animations: this.lifecycleManager.getStatus(),
      memory: this.strokeTextureManager.getMemoryInfo()
    };
  }
  
  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.strokeTextureManager?.dispose();
    this.lifecycleManager?.dispose();
    this.matrixBuffer?.dispose();
    this.globalParamsBuffer?.dispose();
    this.scene?.dispose();
    this.engine?.dispose();
  }
}
