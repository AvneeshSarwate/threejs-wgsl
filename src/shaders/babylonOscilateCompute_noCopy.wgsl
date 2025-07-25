struct Params {
    time: f32,
    instanceCount: f32,
    gridSize: f32,
    padding: f32,
};

@group(0) @binding(0) var<storage, read_write> matrices: array<mat4x4<f32>>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    if (index >= u32(params.instanceCount)) {
        return;
    }
    
    let i = f32(index);
    let row = floor(i / params.gridSize);
    let col = i % params.gridSize;
    
    // Base grid position
    let spacing = 0.4;
    let offsetX = (params.gridSize - 1.0) * spacing * 0.5;
    let offsetZ = (params.gridSize - 1.0) * spacing * 0.5;
    
    let baseX = col * spacing - offsetX;
    let baseZ = row * spacing - offsetZ;
    
    // Multi-layered wave animation
    let time = params.time;
    
    // Primary wave
    let wave1 = sin(time * 0.8 + col * 0.2 + row * 0.1) * 1.5;
    let wave2 = cos(time * 0.6 + row * 0.15) * 1.2;
    
    // Secondary wave for more complex motion
    let wave3 = sin(time * 1.2 + i * 0.05) * 0.8;
    let wave4 = cos(time * 0.4 + col * 0.3 - row * 0.2) * 0.6;
    
    // Radial wave from center
    let centerDist = sqrt(baseX * baseX + baseZ * baseZ);
    let radialWave = sin(time * 1.0 - centerDist * 0.5) * 0.5;
    
    // Combine waves
    let x = baseX + (wave1 + wave4) * 0.5;
    let y = (wave3 + radialWave) * 0.8;
    let z = baseZ + (wave2 + wave4) * 0.5;
    
    // Create rotation matrix
    let rotationY = time * 0.5 + i * 0.1;
    let scale = 1.0 + sin(time * 2.0 + i * 0.05) * 0.2;
    
    let cosY = cos(rotationY);
    let sinY = sin(rotationY);
    
    // Create transformation matrix directly in row-major layout for Babylon.js
    matrices[index] = mat4x4<f32>(
        // Row 0 (column 0 in WGSL column-major)
        scale * cosY, 0.0, scale * -sinY, 0.0,
        // Row 1 (column 1 in WGSL column-major)  
        0.0, scale, 0.0, 0.0,
        // Row 2 (column 2 in WGSL column-major)
        scale * sinY, 0.0, scale * cosY, 0.0,
        // Row 3 (column 3 in WGSL column-major) - translation
        x, y, z, 1.0
    );
}