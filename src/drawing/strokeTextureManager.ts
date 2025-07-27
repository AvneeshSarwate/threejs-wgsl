import * as BABYLON from 'babylonjs';
import type { StrokePoint } from './strokeTypes';
import { DRAWING_CONSTANTS } from './constants';

export class StrokeTextureManager {
  private engine: BABYLON.WebGPUEngine;
  private strokeTexture!: BABYLON.RawTexture;
  private maxStrokes: number = DRAWING_CONSTANTS.MAX_STROKES;
  private pointsPerStroke: number = DRAWING_CONSTANTS.POINTS_PER_STROKE;
  private textureData!: Float32Array;
  
  constructor(engine: BABYLON.WebGPUEngine) {
    this.engine = engine;
    this.createStrokeTexture();
  }
  
  private createStrokeTexture(): void {
    // Create RG32Float texture: 1024 width (points) x 64 height (strokes)
    // Each texel stores (x,y) coordinates as RG channels
    const texWidth = this.pointsPerStroke;
    const texHeight = this.maxStrokes;
    
    // Initialize texture data with zeros
    this.textureData = new Float32Array(texWidth * texHeight * 2);
    
    const float16Array = new Float16Array(this.textureData)

    this.strokeTexture = new BABYLON.RawTexture(
      float16Array,
      texWidth,
      texHeight,
      BABYLON.Constants.TEXTUREFORMAT_RG,
      this.engine,
      false, // no mipmaps
      false, // not a cube
      BABYLON.Texture.LINEAR_LINEAR,
      BABYLON.Constants.TEXTURETYPE_HALF_FLOAT, // Use half-float for filterable sampling
      undefined,
      undefined,
      undefined // Remove storage flag - this texture is for sampling only
    );
    
    // Set proper texture wrapping
    this.strokeTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this.strokeTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  }
  
  /**
   * Upload stroke data to specific row in texture
   */
  uploadStroke(strokeIndex: number, points: StrokePoint[]): void {
    if (strokeIndex < 0 || strokeIndex >= this.maxStrokes) {
      throw new Error(`Stroke index ${strokeIndex} out of range [0, ${this.maxStrokes})`);
    }
    
    if (points.length !== this.pointsPerStroke) {
      throw new Error(`Stroke must have exactly ${this.pointsPerStroke} points, got ${points.length}`);
    }
    
    // Calculate the starting index for this stroke row
    const rowStartIndex = strokeIndex * this.pointsPerStroke * 2; // 2 floats per point (RG)
    
    // Copy stroke data into texture buffer
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const bufferIndex = rowStartIndex + i * 2;
      
      this.textureData[bufferIndex] = point.x;      // R channel
      this.textureData[bufferIndex + 1] = point.y;  // G channel
    }
    
    // Update the texture on GPU
    const float16Array = new Float16Array(this.textureData);

    this.strokeTexture.update(float16Array);
  }
  
  /**
   * Batch upload multiple strokes for efficiency
   */
  uploadStrokes(strokes: { index: number; points: StrokePoint[] }[]): void {
    let needsUpdate = false;
    
    for (const stroke of strokes) {
      if (stroke.index < 0 || stroke.index >= this.maxStrokes) {
        console.warn(`Skipping stroke index ${stroke.index} - out of range [0, ${this.maxStrokes})`);
        continue;
      }
      
      if (stroke.points.length !== this.pointsPerStroke) {
        console.warn(`Skipping stroke ${stroke.index} - incorrect point count ${stroke.points.length}, expected ${this.pointsPerStroke}`);
        continue;
      }
      
      // Calculate the starting index for this stroke row
      const rowStartIndex = stroke.index * this.pointsPerStroke * 2;
      
      // Copy stroke data into texture buffer
      for (let i = 0; i < stroke.points.length; i++) {
        const point = stroke.points[i];
        const bufferIndex = rowStartIndex + i * 2;
        
        this.textureData[bufferIndex] = point.x;      // R channel
        this.textureData[bufferIndex + 1] = point.y;  // G channel
      }
      
      needsUpdate = true;
    }
    
    // Single GPU update after all strokes are processed
    if (needsUpdate) {
      this.strokeTexture.update(this.textureData);
    }
  }
  
  /**
   * Clear a specific stroke from the texture
   */
  clearStroke(strokeIndex: number): void {
    if (strokeIndex < 0 || strokeIndex >= this.maxStrokes) {
      throw new Error(`Stroke index ${strokeIndex} out of range [0, ${this.maxStrokes})`);
    }
    
    const rowStartIndex = strokeIndex * this.pointsPerStroke * 2;
    
    // Zero out the stroke data
    for (let i = 0; i < this.pointsPerStroke * 2; i++) {
      this.textureData[rowStartIndex + i] = 0;
    }
    
    this.strokeTexture.update(this.textureData);
  }
  
  /**
   * Clear all stroke data
   */
  clearAllStrokes(): void {
    this.textureData.fill(0);
    this.strokeTexture.update(this.textureData);
  }
  
  /**
   * Get texture for binding to compute shader
   */
  getStrokeTexture(): BABYLON.RawTexture {
    return this.strokeTexture;
  }
  
  /**
   * Get texture dimensions
   */
  getTextureDimensions(): { width: number; height: number } {
    return {
      width: this.pointsPerStroke,
      height: this.maxStrokes
    };
  }
  
  /**
   * Get memory usage information
   */
  getMemoryInfo(): { 
    totalBytes: number; 
    usedBytes: number; 
    bytesPerStroke: number;
  } {
    const bytesPerStroke = this.pointsPerStroke * 2 * 2; // 2 half-floats * 2 bytes per half-float
    const totalBytes = this.maxStrokes * bytesPerStroke;
    
    return {
      totalBytes,
      usedBytes: totalBytes, // Always fully allocated
      bytesPerStroke
    };
  }
  
  /**
   * Validate stroke data before upload
   */
  validateStrokeData(points: StrokePoint[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (points.length !== this.pointsPerStroke) {
      errors.push(`Point count mismatch: expected ${this.pointsPerStroke}, got ${points.length}`);
    }
    
    // Check for valid coordinates
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      
      if (!isFinite(point.x) || !isFinite(point.y)) {
        errors.push(`Point ${i} has invalid coordinates: (${point.x}, ${point.y})`);
      }
      
      if (point.t < 0 || point.t > 1) {
        errors.push(`Point ${i} has invalid t parameter: ${point.t} (should be [0,1])`);
      }
    }
    
    // Check t parameter progression
    for (let i = 1; i < points.length; i++) {
      if (points[i].t < points[i - 1].t) {
        errors.push(`Point ${i} has decreasing t parameter: ${points[i].t} < ${points[i - 1].t}`);
        break;
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Dispose of GPU resources
   */
  dispose(): void {
    if (this.strokeTexture) {
      this.strokeTexture.dispose();
    }
  }
}
