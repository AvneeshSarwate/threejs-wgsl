# Detailed Implementation Plan: Hand-drawn Stroke Animation System

## Overview
This document outlines the detailed implementation plan for creating a hand-drawn stroke animation system in Babylon.js with WebGPU compute shaders. The system will animate multiple stroke instances simultaneously, with stroke interpolation, parametric animation, and interactive launching.

## System Architecture

### High-Level Components
1. **Stroke Data Management** - Generate, normalize, and store stroke path data
2. **GPU Texture Storage** - Store stroke paths in GPU-accessible texture format
3. **Animation Configuration** - Launch parameters and lifecycle management 
4. **Compute Shader Animation** - GPU-based stroke animation and rendering
5. **Interactive UI** - Mouse-based launching and parameter control

## Detailed Implementation Steps

### Step 3: Stroke Data Interpolation and Texture Storage System

#### 3.1 Stroke Data Generator (Test Data)
**File**: `src/strokeDataGenerator.ts`

Create a generator for test stroke data to simulate hand-drawn input:

```typescript
interface StrokePoint {
  x: number;
  y: number;
  t: number; // normalized time parameter [0,1]
}

interface Stroke {
  id: string;
  points: StrokePoint[];
  boundingBox: { minX: number, maxX: number, minY: number, maxY: number };
}

class StrokeDataGenerator {
  // Generate circle stroke with specified point count
  generateCircle(radius: number, pointCount: number): Stroke
  
  // Generate square stroke 
  generateSquare(size: number, pointCount: number): Stroke
  
  // Generate noise-based organic stroke using simplex noise
  generateNoiseStroke(amplitude: number, frequency: number, pointCount: number): Stroke
  
  // Generate figure-8 pattern
  generateFigureEight(scale: number, pointCount: number): Stroke
}
```

**Test strokes to generate:**
- Circle (various radii: 50px, 100px, 150px)
- Square (various sizes: 80px, 120px, 160px)  
- Figure-8 patterns (various scales)
- Organic curves using simplex noise (3-4 different frequency/amplitude combinations)

#### 3.2 Stroke Interpolation and Normalization
**File**: `src/strokeInterpolator.ts`

```typescript
class StrokeInterpolator {
  private readonly NORMALIZED_POINT_COUNT = 1024; // Standard length for all strokes (match workgroup size)
  
  // Interpolate stroke to standard length using cubic spline interpolation
  normalizeStroke(stroke: Stroke): StrokePoint[]
  
  // Interpolate between two normalized strokes
  interpolateStrokes(strokeA: StrokePoint[], strokeB: StrokePoint[], t: number): StrokePoint[]
  
  // Calculate arc-length parameterization for smooth interpolation
  private calculateArcLengthParams(points: StrokePoint[]): number[]
  
  // Cubic spline interpolation between points
  private cubicSplineInterpolate(points: StrokePoint[], t: number): StrokePoint
}
```

**Normalization approach:**
- Use arc-length parameterization for even spacing
- Resample all strokes to exactly 1024 points (matching compute workgroup thread count)
- Maintain relative shape proportions during resampling

#### 3.3 GPU Texture Storage System
**File**: `src/strokeTextureManager.ts`

```typescript
class StrokeTextureManager {
  private engine: BABYLON.WebGPUEngine;
  private strokeTexture: BABYLON.RawTexture;
  private maxStrokes: number = 64; // Maximum number of stored strokes
  private pointsPerStroke: number = 1024; // Match workgroup size for proper sampling
  
  constructor(engine: BABYLON.WebGPUEngine) {
    this.createStrokeTexture();
  }
  
  private createStrokeTexture(): void {
    // Create RG32Float texture: 1024 width (points) x 64 height (strokes)
    // Each texel stores (x,y) coordinates as RG channels
    const texWidth = this.pointsPerStroke;
    const texHeight = this.maxStrokes;
    
    const strokeTextureData = new Float32Array(texWidth * texHeight * 2);
    
    this.strokeTexture = new BABYLON.RawTexture(
      strokeTextureData,
      texWidth,
      texHeight,
      BABYLON.Constants.TEXTUREFORMAT_RG,
      this.engine,
      false, // no mipmaps
      false, // not a cube
      BABYLON.Texture.NEAREST_NEAREST,
      BABYLON.Constants.TEXTURETYPE_FLOAT,
      undefined,
      undefined,
      BABYLON.Constants.TEXTURE_CREATIONFLAG_STORAGE
    );
  }
  
  // Upload stroke data to specific row in texture
  uploadStroke(strokeIndex: number, points: StrokePoint[]): void
  
  // Get texture for binding to compute shader
  getStrokeTexture(): BABYLON.RawTexture
  
  // Batch upload multiple strokes
  uploadStrokes(strokes: { index: number, points: StrokePoint[] }[]): void
}
```

**Updated Texture Layout:**
- **Width**: 1024 pixels (one per stroke point, matching workgroup thread count)
- **Height**: 64 pixels (one per stroke)
- **Format**: RG32Float (2 floats per pixel for x,y coordinates)
- **Total storage**: 1024 × 64 × 2 × 4 bytes = 524KB

### Step 4: Animation Configuration and Lifecycle Management

#### 4.1 Launch Configuration Structure
**File**: `src/animationConfig.ts`

```typescript
interface LaunchConfig {
  id: string;
  strokeAIndex: number;     // Index into stroke texture (0-63)
  strokeBIndex: number;     // Index for interpolation target
  interpolationT: number;   // Blend factor between strokeA and strokeB [0,1]
  
  // Timing
  totalDuration: number;    // Total animation duration in seconds
  elapsedTime: number;      // Current elapsed time
  startTime: number;        // When animation started
  
  // Spatial transform
  startPoint: { x: number, y: number };  // Canvas coordinates (0-1280, 0-720)
  scale: number;            // Size multiplier
  
  // Animation state
  active: boolean;
  phase: number;           // Current animation phase [0,1]
}

// Storage buffer layout for GPU (aligned to 16-byte boundaries)
interface GPULaunchConfig {
  strokeAIndex: number;    // Index of first stroke in texture
  strokeBIndex: number;    // Index of second stroke for interpolation
  interpolationT: number;
  totalDuration: number;
  
  elapsedTime: number;
  startPointX: number;
  startPointY: number;
  scale: number;
  
  active: number;          // 1.0 = active, 0.0 = inactive
  phase: number;
  reserved1: number;       // Padding for 16-byte alignment
  reserved2: number;
}
```

#### 4.2 Draw Lifecycle Manager
**File**: `src/drawLifecycleManager.ts`

```typescript
class DrawLifecycleManager {
  private priorityQueue: PriorityQueue<LaunchConfig>;
  private activeConfigs: Map<string, LaunchConfig>;
  private gpuConfigBuffer: BABYLON.StorageBuffer;
  private maxSimultaneousAnimations: number = 1024;
  
  constructor(engine: BABYLON.WebGPUEngine) {
    this.priorityQueue = new PriorityQueue<LaunchConfig>();
    this.activeConfigs = new Map();
    this.createGPUBuffer(engine);
  }
  
  private createGPUBuffer(engine: BABYLON.WebGPUEngine): void {
    // Create storage buffer for 1024 launch configs
    const bufferSize = this.maxSimultaneousAnimations * 12 * 4; // 12 floats per config
    this.gpuConfigBuffer = new BABYLON.StorageBuffer(
      engine,
      bufferSize,
      BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX
    );
  }
  
  // Add new animation to queue
  addAnimation(config: LaunchConfig): void {
    const deadline = performance.now() + config.totalDuration * 1000;
    this.priorityQueue.add(config.id, deadline, config);
  }
  
  // Update all active animations and GPU buffer
  tick(currentTime: number): void {
    this.processQueue(currentTime);
    this.updateActiveAnimations(currentTime);
    this.uploadToGPU();
  }
  
  private processQueue(currentTime: number): void {
    // Move animations from queue to active when ready
    // Remove completed animations
  }
  
  private updateActiveAnimations(currentTime: number): void {
    // Update elapsed time and phase for each active animation
  }
  
  private uploadToGPU(): void {
    // Pack active configs into GPU buffer format and upload
  }
  
  // Get GPU buffer for compute shader binding
  getGPUBuffer(): BABYLON.StorageBuffer
  
  // Interactive launch from mouse click
  launchFromMouseClick(x: number, y: number, strokeA: number, strokeB: number): void
}
```

**Priority queue usage:**
- **Deadline**: Animation completion time (startTime + duration)
- **Metadata**: Complete LaunchConfig object
- **Processing**: Remove completed animations, activate queued ones

### Step 5: Stroke Animation Compute Shader

#### 5.1 Compute Shader Structure
**File**: `src/shaders/strokeAnimation.wgsl`

```wgsl
struct LaunchConfig {
    strokeAIndex: f32,
    strokeBIndex: f32,
    interpolationT: f32,
    totalDuration: f32,
    
    elapsedTime: f32,
    startPointX: f32,
    startPointY: f32,
    scale: f32,
    
    active: f32,
    phase: f32,
    reserved1: f32,
    reserved2: f32,
};

struct GlobalParams {
    time: f32,
    canvasWidth: f32,
    canvasHeight: f32,
    maxAnimations: f32,
    deltaTime: f32,
    padding1: f32,
    padding2: f32,
    padding3: f32,
};

// Bindings
@group(0) @binding(0) var<storage, read_write> instanceMatrices: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> launchConfigs: array<LaunchConfig>;
@group(0) @binding(2) var<uniform> globalParams: GlobalParams;
@group(0) @binding(3) var strokeTexture: texture_2d<f32>;
@group(0) @binding(4) var strokeSampler: sampler;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let animationIndex = id.x;
    if (animationIndex >= u32(globalParams.maxAnimations)) {
        return;
    }
    
    var config = launchConfigs[animationIndex];
    if (config.active < 0.5) {
        // Deactivate instance by moving off-screen
        setInactiveInstance(animationIndex);
        return;
    }
    
    // Update animation phase
    config.phase = clamp(config.elapsedTime / config.totalDuration, 0.0, 1.0);
    config.elapsedTime += globalParams.deltaTime;
    
    // Check if animation completed
    if (config.phase >= 1.0) {
        config.active = 0.0;
        setInactiveInstance(animationIndex);
        launchConfigs[animationIndex] = config;
        return;
    }
    
    // Get stroke indices directly
    let strokeAIndex = u32(config.strokeAIndex);
    let strokeBIndex = u32(config.strokeBIndex);
    
    // Sample stroke positions with interpolation
    let strokePointA = sampleStroke(strokeAIndex, config.phase);
    let strokePointB = sampleStroke(strokeBIndex, config.phase);
    let interpolatedPoint = mix(strokePointA, strokePointB, config.interpolationT);
    
    // Transform to canvas coordinates
    let canvasPos = transformToCanvas(interpolatedPoint, config);
    
    // Convert to normalized device coordinates
    let ndc = canvasToNDC(canvasPos, globalParams.canvasWidth, globalParams.canvasHeight);
    
    // Build transformation matrix
    buildTransformMatrix(animationIndex, ndc, config.scale);
    
    // Write back updated config
    launchConfigs[animationIndex] = config;
}

fn sampleStroke(strokeIndex: u32, phase: f32) -> vec2<f32> {
    let textureCoord = vec2<f32>(phase, f32(strokeIndex) / 64.0);
    return textureSampleLevel(strokeTexture, strokeSampler, textureCoord, 0.0).rg;
}

fn transformToCanvas(strokePoint: vec2<f32>, config: LaunchConfig) -> vec2<f32> {
    return vec2<f32>(
        config.startPointX + strokePoint.x * config.scale,
        config.startPointY + strokePoint.y * config.scale
    );
}

fn canvasToNDC(canvasPos: vec2<f32>, canvasWidth: f32, canvasHeight: f32) -> vec2<f32> {
    let aspectRatio = canvasWidth / canvasHeight;
    let ndcX = ((canvasPos.x / canvasWidth) * 2.0 - 1.0) * aspectRatio;
    let ndcY = -((canvasPos.y / canvasHeight) * 2.0 - 1.0);
    return vec2<f32>(ndcX, ndcY);
}

fn buildTransformMatrix(instanceIndex: u32, position: vec2<f32>, scale: f32) {
    let base = instanceIndex * 4u;
    
    // Simple 2D translation matrix (no rotation for stroke points)
    instanceMatrices[base + 0u] = vec4<f32>(scale, 0.0, 0.0, 0.0);
    instanceMatrices[base + 1u] = vec4<f32>(0.0, scale, 0.0, 0.0);
    instanceMatrices[base + 2u] = vec4<f32>(0.0, 0.0, 1.0, 0.0);
    instanceMatrices[base + 3u] = vec4<f32>(position.x, position.y, 0.0, 1.0);
}

fn setInactiveInstance(instanceIndex: u32) {
    let base = instanceIndex * 4u;
    // Move far off-screen for culling
    instanceMatrices[base + 3u] = vec4<f32>(-10000.0, 0.0, 0.0, 1.0);
}
```

#### 5.2 Progressive Stroke Drawing with Optimized Workgroup Size

The system uses the sophisticated wave-based drawing approach but with optimal workgroup sizing for WebGPU performance. Instead of coupling workgroup structure to stroke organization, we use global indexing for flexibility.

**Optimized Workgroup Strategy:**
- **Workgroup size: 64 threads** (optimal for most GPUs - matches warp/wavefront sizes)
- **Global indexing**: Decouple shader logic from workgroup layout for flexibility
- **Linear dispatch**: Simple 1D dispatch with `global_invocation_id` for index calculation
- **Wave-like revelation** using the `phaser` function for smooth drawing animation

```wgsl
// Optimized compute shader with flexible workgroup sizing
const POINTS_PER_STROKE: u32 = 1024u;

@compute @workgroup_size(64, 1, 1)  // Optimal workgroup size for most GPUs
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let globalIndex = globalId.x;
    
    // Calculate stroke and point indices from global index
    let strokeIndex = globalIndex / POINTS_PER_STROKE;
    let pointIndex = globalIndex % POINTS_PER_STROKE;
    
    // Early exit for out-of-bounds threads
    if (strokeIndex >= u32(globalParams.maxAnimations)) {
        return;
    }
    
    let config = launchConfigs[strokeIndex];
    if (config.active < 0.5) {
        setInactiveInstance(globalIndex);
        return;
    }
    
    // Calculate this point's position along the stroke (0.0-1.0)
    let pointProgress = f32(pointIndex) / f32(POINTS_PER_STROKE);
    
    // Use phaser function to create wave-like drawing effect
    let phaseVal = clamp(phaser(config.phase, pointProgress, 1.0), 0.0, 0.9999);
    
    // If this point hasn't been "revealed" yet, hide it
    if (phaseVal <= 0.001) {
        setInactiveInstance(globalIndex);
        return;
    }
    
    // Sample stroke positions with interpolation at this point along the path
    let strokePointA = sampleStroke(u32(config.strokeAIndex), pointProgress);
    let strokePointB = sampleStroke(u32(config.strokeBIndex), pointProgress);
    let interpolatedPoint = mix(strokePointA, strokePointB, config.interpolationT);
    
    // Transform to canvas coordinates
    let canvasPos = transformToCanvas(interpolatedPoint, config);
    let ndc = canvasToNDC(canvasPos, globalParams.canvasWidth, globalParams.canvasHeight);
    
    // Use global index directly for instance indexing
    let instanceIndex = globalIndex;
    
    // Scale point size based on reveal phase for smooth appearance
    let pointScale = 0.003 * phaseVal;  // Small circles that fade in
    buildTransformMatrix(instanceIndex, ndc, pointScale);
}

// Wave-like drawing animation function (ported from TouchDesigner)
fn phaser(pct: f32, phase: f32, e: f32) -> f32 {
    return clamp((phase - 1.0 + pct * (1.0 + e)) / e, 0.0, 1.0);
}

fn setInactiveInstance(instanceIndex: u32) {
    let base = instanceIndex * 4u;
    // Move far off-screen for culling
    instanceMatrices[base + 3u] = vec4<f32>(-10000.0, 0.0, 0.0, 1.0);
}
```

**Performance Optimizations:**
- **64-thread workgroups**: Align with GPU warp/wavefront sizes (32 for NVIDIA, 64 for AMD)
- **Higher occupancy**: Smaller workgroups = less register pressure = more active workgroups per CU/SM
- **Global indexing**: Shader logic independent of workgroup size - can tune performance without code changes
- **1D dispatch**: Simpler than 2D, often performs better according to profiling data

### Step 6: Babylon.js Scene Integration

#### 6.1 Main Drawing Scene
**File**: `src/drawingScene.ts`

```typescript
export class DrawingScene {
  private engine: BABYLON.WebGPUEngine;
  private scene: BABYLON.Scene;
  private strokeTextureManager: StrokeTextureManager;
  private lifecycleManager: DrawLifecycleManager;
  private computeShader: BABYLON.ComputeShader;
  private instancedMesh: BABYLON.Mesh;
  private maxAnimations: number = 64;    // Maximum concurrent stroke animations
  private pointsPerStroke: number = 1024; // Points per stroke (workgroup size)
  private maxInstances: number = this.maxAnimations * this.pointsPerStroke; // 65,536 total instances
  
  async createScene(canvas: HTMLCanvasElement): Promise<void> {
    await this.initializeEngine(canvas);
    this.setupCamera();
    this.setupMaterials();
    await this.setupStrokeData();
    await this.setupComputeShader();
    this.setupInteraction();
    this.startRenderLoop();
  }
  
  private async setupStrokeData(): Promise<void> {
    // Generate test strokes
    const generator = new StrokeDataGenerator();
    const interpolator = new StrokeInterpolator();
    
    const testStrokes = [
      generator.generateCircle(100, 100),
      generator.generateSquare(120, 100),
      generator.generateFigureEight(80, 100),
      generator.generateNoiseStroke(50, 0.1, 100),
      // ... more test strokes
    ];
    
    // Normalize and upload to GPU
    const normalizedStrokes = testStrokes.map(stroke => ({
      index: testStrokes.indexOf(stroke),
      points: interpolator.normalizeStroke(stroke)
    }));
    
    this.strokeTextureManager.uploadStrokes(normalizedStrokes);
  }
  
  private async setupComputeShader(): Promise<void> {
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
    this.computeShader.setTexture("strokeTexture", this.strokeTextureManager.getStrokeTexture());
    this.computeShader.setSampler("strokeSampler", this.engine.createSampler({}));
  }
  
  private setupInteraction(): void {
    this.scene.getEngine().getRenderingCanvas()?.addEventListener('click', (event) => {
      const rect = this.scene.getEngine().getRenderingCanvas()!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      // Launch new animation
      const strokeA = Math.floor(Math.random() * 10); // Random stroke A
      const strokeB = Math.floor(Math.random() * 10); // Random stroke B
      this.lifecycleManager.launchFromMouseClick(x, y, strokeA, strokeB);
    });
  }
  
  private startRenderLoop(): void {
    this.scene.registerBeforeRender(() => {
      const currentTime = performance.now() * 0.001;
      
      // Update animation lifecycle
      this.lifecycleManager.tick(currentTime);
      
      // Update global parameters
      this.updateGlobalParams(currentTime);
      
      // Dispatch compute shader with optimized 1D layout
      // Total threads needed: maxAnimations × pointsPerStroke
      const totalThreads = this.maxAnimations * this.pointsPerStroke;
      const workgroupSize = 64;  // Must match @workgroup_size in shader
      const workgroups = Math.ceil(totalThreads / workgroupSize);
      this.computeShader.dispatch(workgroups, 1, 1);
    });
    
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
  }
}
```

#### 6.2 UI Controls
**File**: `src/ui/strokeLauncherUI.ts`

```typescript
class StrokeLauncherUI {
  private container: HTMLElement;
  private drawingScene: DrawingScene;
  
  createUI(): void {
    this.container = document.createElement('div');
    this.container.className = 'stroke-launcher-ui';
    this.container.innerHTML = `
      <div class="controls">
        <h3>Stroke Animation Controls</h3>
        
        <div class="control-group">
          <label>Stroke A:</label>
          <select id="strokeA">
            <option value="0">Circle</option>
            <option value="1">Square</option>
            <option value="2">Figure-8</option>
            <option value="3">Noise 1</option>
          </select>
        </div>
        
        <div class="control-group">
          <label>Stroke B:</label>
          <select id="strokeB">
            <option value="0">Circle</option>
            <option value="1">Square</option>
            <option value="2">Figure-8</option>
            <option value="3">Noise 1</option>
          </select>
        </div>
        
        <div class="control-group">
          <label>Interpolation:</label>
          <input type="range" id="interpolation" min="0" max="1" step="0.1" value="0">
          <span id="interpValue">0.0</span>
        </div>
        
        <div class="control-group">
          <label>Duration (s):</label>
          <input type="range" id="duration" min="0.5" max="5" step="0.1" value="2">
          <span id="durationValue">2.0</span>
        </div>
        
        <div class="control-group">
          <label>Scale:</label>
          <input type="range" id="scale" min="0.5" max="3" step="0.1" value="1">
          <span id="scaleValue">1.0</span>
        </div>
        
        <button id="launchRandom">Launch Random</button>
        <button id="clearAll">Clear All</button>
      </div>
      
      <div class="info">
        <p>Click on canvas to launch stroke animation</p>
        <p>Active animations: <span id="activeCount">0</span></p>
      </div>
    `;
    
    document.body.appendChild(this.container);
    this.bindEvents();
  }
  
  private bindEvents(): void {
    // Bind UI events to update drawing scene parameters
  }
}
```

## Implementation Timeline

### Phase 1: Foundation (Days 1-2)
- [ ] Create stroke data generator with test shapes
- [ ] Implement stroke interpolation and normalization
- [ ] Set up basic GPU texture storage

### Phase 2: Animation System (Days 3-4)  
- [ ] Build launch configuration structure
- [ ] Implement DrawLifecycleManager with priority queue
- [ ] Create GPU storage buffers for animation data

### Phase 3: Compute Shader (Days 5-6)
- [ ] Write stroke animation compute shader (WGSL)
- [ ] Implement stroke sampling and interpolation in shader
- [ ] Add transformation matrix generation

### Phase 4: Scene Integration (Days 7-8)
- [ ] Integrate compute shader with Babylon.js scene
- [ ] Set up instanced rendering for stroke points
- [ ] Add mouse interaction for launching animations

### Phase 5: UI and Polish (Days 9-10)
- [ ] Create parameter control UI
- [ ] Add visual feedback and debugging
- [ ] Performance optimization and testing

## Technical Considerations

### Performance Targets
- **60 FPS** with 1024 simultaneous stroke animations
- **Compute shader dispatch**: ~0.5ms per frame
- **Memory usage**: <50MB total GPU memory

### Error Handling
- Graceful degradation if WebGPU not available
- Validate stroke data before GPU upload
- Handle compute shader compilation errors

### Future Extensions
- Real handwriting input integration
- Stroke pressure and velocity data
- Advanced interpolation algorithms (bezier, catmull-rom)
- Export animations to video/GIF

## Dependencies

### Existing Code Reuse
- **PriorityQueue**: Already implemented in `priorityQueue.ts`
- **Babylon.js setup**: Reuse pattern from `babylon2DScene.ts`
- **Compute shader binding**: Adapt from `circleRotation2D.wgsl`

### New Dependencies
- Simplex noise library for organic stroke generation
- Optional: dat.GUI for enhanced UI controls
