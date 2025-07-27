import type { Stroke, StrokePoint } from './strokeTypes';
import { DRAWING_CONSTANTS } from './constants';

export class StrokeDataGenerator {
  
  /**
   * Generate a circular stroke with specified radius and point count
   */
  generateCircle(radius: number, pointCount: number = DRAWING_CONSTANTS.POINTS_PER_STROKE): Stroke {
    const points: StrokePoint[] = [];
    
    for (let i = 0; i < pointCount; i++) {
      const t = i / (pointCount - 1);
      const angle = t * 2 * Math.PI;
      
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        t
      });
    }
    
    return {
      id: `circle_${radius}`,
      points,
      boundingBox: {
        minX: -radius,
        maxX: radius,
        minY: -radius,
        maxY: radius
      }
    };
  }
  
  /**
   * Generate a square stroke with specified size
   */
  generateSquare(size: number, pointCount: number = DRAWING_CONSTANTS.POINTS_PER_STROKE): Stroke {
    const points: StrokePoint[] = [];
    const halfSize = size / 2;
    const pointsPerSide = Math.floor(pointCount / 4);
    const remainder = pointCount % 4;
    
    let currentPoint = 0;
    
    // Top edge (left to right)
    for (let i = 0; i < pointsPerSide + (remainder > 0 ? 1 : 0); i++) {
      const progress = i / pointsPerSide;
      points.push({
        x: -halfSize + progress * size,
        y: -halfSize,
        t: currentPoint / (pointCount - 1)
      });
      currentPoint++;
    }
    
    // Right edge (top to bottom)
    for (let i = 1; i < pointsPerSide + (remainder > 1 ? 1 : 0); i++) {
      const progress = i / pointsPerSide;
      points.push({
        x: halfSize,
        y: -halfSize + progress * size,
        t: currentPoint / (pointCount - 1)
      });
      currentPoint++;
    }
    
    // Bottom edge (right to left)
    for (let i = 1; i < pointsPerSide + (remainder > 2 ? 1 : 0); i++) {
      const progress = i / pointsPerSide;
      points.push({
        x: halfSize - progress * size,
        y: halfSize,
        t: currentPoint / (pointCount - 1)
      });
      currentPoint++;
    }
    
    // Left edge (bottom to top)
    for (let i = 1; i < pointsPerSide; i++) {
      const progress = i / pointsPerSide;
      points.push({
        x: -halfSize,
        y: halfSize - progress * size,
        t: currentPoint / (pointCount - 1)
      });
      currentPoint++;
    }
    
    // Ensure we have exactly pointCount points
    while (points.length < pointCount) {
      const lastPoint = points[points.length - 1];
      points.push({
        x: lastPoint.x,
        y: lastPoint.y,
        t: (points.length) / (pointCount - 1)
      });
    }
    
    return {
      id: `square_${size}`,
      points: points.slice(0, pointCount),
      boundingBox: {
        minX: -halfSize,
        maxX: halfSize,
        minY: -halfSize,
        maxY: halfSize
      }
    };
  }
  
  /**
   * Generate a figure-8 pattern
   */
  generateFigureEight(scale: number, pointCount: number = DRAWING_CONSTANTS.POINTS_PER_STROKE): Stroke {
    const points: StrokePoint[] = [];
    
    for (let i = 0; i < pointCount; i++) {
      const t = i / (pointCount - 1);
      const angle = t * 2 * Math.PI;
      
      // Parametric figure-8 (lemniscate)
      const denominator = 1 + Math.sin(angle) * Math.sin(angle);
      
      points.push({
        x: (scale * Math.cos(angle)) / denominator,
        y: (scale * Math.sin(angle) * Math.cos(angle)) / denominator,
        t
      });
    }
    
    // Calculate bounding box
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    
    return {
      id: `figure8_${scale}`,
      points,
      boundingBox: {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
      }
    };
  }

  generatePointsInPlaceStroke(pointCount: number = DRAWING_CONSTANTS.POINTS_PER_STROKE) {
    let points: StrokePoint[] = [];

    for(let i = 0; i < pointCount; i++) {
      points.push({
        x: Math.random(),
        y: Math.random(),
        t: i / (pointCount - 1)
      });
    }
    
    return {
      id: 'points_in_place',
      points,
      boundingBox: {
        minX: 0,
        maxX: 1,
        minY: 0,
        maxY: 1
      }
    };
  }
  
  /**
   * Generate an organic stroke using simplex noise
   */
  generateNoiseStroke(amplitude: number, frequency: number, pointCount: number = DRAWING_CONSTANTS.POINTS_PER_STROKE): Stroke {
    const points: StrokePoint[] = [];
    
    // Simple noise function (using sin waves for deterministic results)
    const noise = (x: number, freq: number): number => {
      return Math.sin(x * freq) * 0.5 + Math.sin(x * freq * 2.7) * 0.3 + Math.sin(x * freq * 5.1) * 0.2;
    };
    
    for (let i = 0; i < pointCount; i++) {
      const t = i / (pointCount - 1);
      const baseAngle = t * 2 * Math.PI;
      
      // Base circular path with noise distortion
      const radius = 100 + amplitude * noise(t, frequency);
      const angleOffset = amplitude * 0.01 * noise(t + 1000, frequency * 0.5);
      
      const finalAngle = baseAngle + angleOffset;
      
      points.push({
        x: Math.cos(finalAngle) * radius,
        y: Math.sin(finalAngle) * radius,
        t
      });
    }
    
    // Calculate bounding box
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    
    return {
      id: `noise_${amplitude}_${frequency}`,
      points,
      boundingBox: {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
      }
    };
  }
  
  /**
   * Generate a complete set of test strokes
   */
  generateTestStrokes(): Stroke[] {
    return [

      this.generatePointsInPlaceStroke(),

      // Circles
      this.generateCircle(50),
      this.generateCircle(100),
      this.generateCircle(150),
      
      // Squares
      this.generateSquare(80),
      this.generateSquare(120),
      this.generateSquare(160),
      
      // Figure-8s
      this.generateFigureEight(80),
      this.generateFigureEight(120),
      
      // Organic curves
      this.generateNoiseStroke(30, 2.0),
      this.generateNoiseStroke(50, 10.5),
      this.generateNoiseStroke(40, 32.0),
      this.generateNoiseStroke(60, 0.8),
    ];
  }
}
