@group(0) @binding(0) var<storage, read> positionStorage: array<vec3f>;
@group(0) @binding(1) var<storage, read> velocityStorage: array<vec3f>;
@group(0) @binding(2) var<storage, read> phaseStorage: array<f32>;

//split-here
fn birdVertex(
    position: vec3f,
    reference: u32,
    birdVertex: u32,
    modelWorldMatrix: mat4x4<f32>,
    cameraProjectionMatrix: mat4x4<f32>,
    cameraViewMatrix: mat4x4<f32>
) -> vec4f {
    var localPosition = position;
    let newPhase = phaseStorage[reference];
    let newVelocity = normalize(velocityStorage[reference]);
    
    // Flap wings
    if (birdVertex == 4u || birdVertex == 7u) {
        localPosition.y = sin(newPhase) * 5.0;
    }
    
    let newPosition = (modelWorldMatrix * vec4<f32>(localPosition, 1.0)).xyz;
    
    // Apply rotation based on velocity direction
    var vel = newVelocity;
    vel.z *= -1.0;
    let xz = length(vel.xz);
    let xyz = 1.0;
    let x = sqrt(1.0 - vel.y * vel.y);
    
    let cosry = vel.x / xz;
    let sinry = vel.z / xz;
    
    let cosrz = x / xyz;
    let sinrz = vel.y / xyz;
    
    // Rotation matrices
    let maty = mat3x3<f32>(
        cosry, 0.0, -sinry,
        0.0, 1.0, 0.0,
        sinry, 0.0, cosry
    );
    
    let matz = mat3x3<f32>(
        cosrz, sinrz, 0.0,
        -sinrz, cosrz, 0.0,
        0.0, 0.0, 1.0
    );
    
    let finalVert = maty * matz * newPosition;
    let finalPosition = finalVert + positionStorage[reference];
    
    return cameraProjectionMatrix * cameraViewMatrix * vec4<f32>(finalPosition, 1.0);
}
