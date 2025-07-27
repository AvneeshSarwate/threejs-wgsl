import { createNoise2D } from 'simplex-noise';

export interface Point {
  x: number;
  y: number;
}

export function makeCircle(numPoints: number): Point[] {
  const points: Point[] = [];
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const radius = 0.4; // Radius to fit in unit square with margin
    const centerX = 0.5;
    const centerY = 0.5;
    
    points.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    });
  }
  
  return points;
}

export function makeSquare(numPoints: number): Point[] {
  const points: Point[] = [];
  const margin = 0.1;
  const size = 1 - 2 * margin;
  
  const pointsPerSide = Math.floor(numPoints / 4);
  const remainder = numPoints % 4;
  
  // Top side
  for (let i = 0; i < pointsPerSide + (remainder > 0 ? 1 : 0); i++) {
    const t = i / (pointsPerSide + (remainder > 0 ? 1 : 0) - 1);
    points.push({
      x: margin + t * size,
      y: margin
    });
  }
  
  // Right side
  for (let i = 1; i < pointsPerSide + (remainder > 1 ? 1 : 0); i++) {
    const t = i / (pointsPerSide + (remainder > 1 ? 1 : 0) - 1);
    points.push({
      x: margin + size,
      y: margin + t * size
    });
  }
  
  // Bottom side
  for (let i = 1; i < pointsPerSide + (remainder > 2 ? 1 : 0); i++) {
    const t = i / (pointsPerSide + (remainder > 2 ? 1 : 0) - 1);
    points.push({
      x: margin + size - t * size,
      y: margin + size
    });
  }
  
  // Left side
  for (let i = 1; i < pointsPerSide; i++) {
    const t = i / (pointsPerSide - 1);
    points.push({
      x: margin,
      y: margin + size - t * size
    });
  }
  
  return points.slice(0, numPoints);
}

export function makeSquiggle(numPoints: number): Point[] {
  const points: Point[] = [];
  const noise2D = createNoise2D();
  
  const amplitude = 0.3;
  const frequency = 3.0;
  const centerY = 0.5;
  
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const x = t;
    
    // Use noise to create organic variation
    const noiseValue = noise2D(t * frequency, 0);
    const y = centerY + amplitude * noiseValue;
    
    points.push({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y))
    });
  }
  
  return points;
}
