struct TestParams {
    count: f32,
    padding1: f32,
    padding2: f32,
    padding3: f32,
    padding4: vec4<f32>,
};

@group(0) @binding(0) var<storage, read_write> matrices: array<mat4x4<f32>>;
@group(0) @binding(1) var<uniform> params: TestParams;

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    if (index >= u32(params.count)) {
        return;
    }
    
    let i = f32(index);
    
    // Test values - same as CPU version
    let x = i * 2.0;
    let y = i * 1.5;
    let z = i * 0.5;
    let rotationY = i * 0.5;
    let scale = 1.0 + i * 0.2;
    
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