struct Params {
    time: f32,
    instanceCount: f32,
    centerX: f32,
    centerY: f32,
    radius: f32,
    canvasWidth: f32,
    canvasHeight: f32,
    padding: f32,
};

// Store as array of vec4 instead of mat4x4 for precise layout control
@group(0) @binding(0) var<storage, read_write> matrices: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    if (index >= u32(params.instanceCount)) {
        return;
    }
    
    let i = f32(index);
    let time = params.time;
    
    // Calculate angle for this circle's position around the main circle
    let angleStep = 6.28318530718 / params.instanceCount; // 2*PI
    let baseAngle = i * angleStep;
    let rotationSpeed = 1.0;
    let currentAngle = baseAngle + time * rotationSpeed;
    
    // Calculate position on the circle in screen coordinates
    let screenX = params.centerX + cos(currentAngle) * params.radius;
    let screenY = params.centerY + sin(currentAngle) * params.radius;
    
    // Convert screen coordinates to normalized device coordinates
    // Account for canvas aspect ratio (1280/720 = 1.777...)
    let aspectRatio = params.canvasWidth / params.canvasHeight;
    let ndcX = ((screenX / params.canvasWidth) * 2.0 - 1.0) * aspectRatio;
    let ndcY = -((screenY / params.canvasHeight) * 2.0 - 1.0); // Flip Y axis
    
    // === EXPLICIT TRANSFORMATION COMPONENTS ===
    
    // Translation (position)
    let translateX = ndcX;
    let translateY = ndcY;
    let translateZ = 0.0;
    
    // Scale (uniform scaling for circular shapes)
    let scaleX = 0.02;
    let scaleY = 0.02;
    let scaleZ = 1.0;
    
    // Rotation (individual circle rotation around Z-axis)
    let rotationAngle = time * 2.0 + i * 0.1;
    let cosR = cos(rotationAngle);
    let sinR = sin(rotationAngle);
    
    // === BUILD TRANSFORMATION MATRIX ===
    // Standard 2D rotation + scale + translation matrix
    // [ scaleX*cosR  -scaleX*sinR  0  translateX ]
    // [ scaleY*sinR   scaleY*cosR  0  translateY ]
    // [     0             0        1  translateZ ]
    // [     0             0        0      1      ]
    
    let base = index * 4u;
    
    // Row 0 (world0): first row of transformation matrix
    matrices[base + 0u] = vec4<f32>(scaleX * cosR, -scaleX * sinR, 0.0, 0.0);
    
    // Row 1 (world1): second row of transformation matrix  
    matrices[base + 1u] = vec4<f32>(scaleY * sinR, scaleY * cosR, 0.0, 0.0);
    
    // Row 2 (world2): third row of transformation matrix
    matrices[base + 2u] = vec4<f32>(0.0, 0.0, scaleZ, 0.0);
    
    // Row 3 (world3): fourth row of transformation matrix (translation)
    matrices[base + 3u] = vec4<f32>(translateX, translateY, translateZ, 1.0);
}
