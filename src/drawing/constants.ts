// Shared constants for the drawing animation system

export const DRAWING_CONSTANTS = {
  // Stroke resolution
  POINTS_PER_STROKE: 1024,
  
  // System limits
  MAX_STROKES: 64,
  MAX_ANIMATIONS: 64,
  
  // GPU optimization
  WORKGROUP_SIZE: 64,
  
  // Canvas dimensions
  CANVAS_WIDTH: 1280,
  CANVAS_HEIGHT: 720,
  
  // Buffer sizes (in bytes)
  LAUNCH_CONFIG_SIZE: 12 * 4, // 12 floats per config
  MATRIX_SIZE: 16 * 4, // 16 floats per matrix (4 vec4)
  
  // Texture dimensions
  STROKE_TEXTURE_WIDTH: 1024, // Points per stroke
  STROKE_TEXTURE_HEIGHT: 64,  // Number of strokes
} as const;

// Type-safe access to constants
export type DrawingConstants = typeof DRAWING_CONSTANTS;
