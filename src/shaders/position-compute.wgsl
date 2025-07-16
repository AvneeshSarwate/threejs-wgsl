@group(0) @binding(0) var<storage, read_write> positionStorage: array<vec3<f32>>;
@group(0) @binding(1) var<storage, read_write> velocityStorage: array<vec3<f32>>;
@group(0) @binding(2) var<storage, read_write> phaseStorage: array<f32>;

fn computePosition(index: u32, deltaTime: f32) {
    // Update position
    let newPosition = positionStorage[index] + velocityStorage[index] * deltaTime * 15.0;
    
    // Update phase
    let velocity = velocityStorage[index];
    let phase = phaseStorage[index];
    
    let modValue = phase + deltaTime + length(velocity.xz) * deltaTime * 3.0 + max(velocity.y, 0.0) * deltaTime * 6.0;
    let newPhase = modValue % 62.83; // 2 * PI * 10
    
    // Write back to storage
    positionStorage[index] = newPosition;
    phaseStorage[index] = newPhase;
}
