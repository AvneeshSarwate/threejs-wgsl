struct Params {
    time: f32,
    instanceCount: u32,
    gridSize: f32,
    minPixelRadius: f32,
    viewportHeight: f32,
    projectionScale: f32,
    baseRadius: f32,
    enableSizeCull: f32,
    cameraPosition: vec4<f32>,
    cameraForward: vec4<f32>,
    frustumPlane0: vec4<f32>,
    frustumPlane1: vec4<f32>,
    frustumPlane2: vec4<f32>,
    frustumPlane3: vec4<f32>,
    frustumPlane4: vec4<f32>,
    frustumPlane5: vec4<f32>,
};

// Matches the five u32 fields of drawIndexedIndirect.
struct DrawArgs {
    indexCount: u32,
    instanceCount: atomic<u32>,
    firstIndex: u32,
    baseVertex: i32,
    firstInstance: u32,
};

@group(0) @binding(0) var<storage, read_write> visibleMatrices: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> visibleColors: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> drawArgs: DrawArgs;
@group(0) @binding(3) var<uniform> params: Params;

fn insidePlane(center: vec3<f32>, radius: f32, plane: vec4<f32>) -> bool {
    return dot(plane.xyz, center) + plane.w >= -radius;
}

fn insideFrustum(center: vec3<f32>, radius: f32) -> bool {
    return insidePlane(center, radius, params.frustumPlane0) &&
        insidePlane(center, radius, params.frustumPlane1) &&
        insidePlane(center, radius, params.frustumPlane2) &&
        insidePlane(center, radius, params.frustumPlane3) &&
        insidePlane(center, radius, params.frustumPlane4) &&
        insidePlane(center, radius, params.frustumPlane5);
}

fn hueToRgb(p: f32, q: f32, initialT: f32) -> f32 {
    let t = fract(initialT);
    if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 0.5) { return q; }
    if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    return p;
}

fn instanceColor(index: u32) -> vec4<f32> {
    let hue = f32(index) / f32(params.instanceCount) * 0.3 + 0.5;
    let q = 0.6 * (1.0 + 0.8);
    let p = 2.0 * 0.6 - q;
    return vec4<f32>(hueToRgb(p, q, hue + 1.0 / 3.0),
        hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1.0 / 3.0), 1.0);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let index = gid.x;
    if (index >= params.instanceCount) { return; }

    let i = f32(index);
    let row = floor(i / params.gridSize);
    let col = i % params.gridSize;
    let spacing = 0.4;
    let offset = (params.gridSize - 1.0) * spacing * 0.5;
    let baseX = col * spacing - offset;
    let baseZ = row * spacing - offset;
    let time = params.time;
    let wave1 = sin(time * 0.8 + col * 0.2 + row * 0.1) * 1.5;
    let wave2 = cos(time * 0.6 + row * 0.15) * 1.2;
    let wave3 = sin(time * 1.2 + i * 0.05) * 0.8;
    let wave4 = cos(time * 0.4 + col * 0.3 - row * 0.2) * 0.6;
    let radialWave = sin(time - sqrt(baseX * baseX + baseZ * baseZ) * 0.5) * 0.5;
    let center = vec3<f32>(baseX + (wave1 + wave4) * 0.5,
        (wave3 + radialWave) * 0.8, baseZ + (wave2 + wave4) * 0.5);
    let scale = 1.0 + sin(time * 2.0 + i * 0.05) * 0.2;
    let radius = params.baseRadius * scale;

    if (!insideFrustum(center, radius)) { return; }
    if (params.enableSizeCull > 0.5) {
        let depth = dot(center - params.cameraPosition.xyz, params.cameraForward.xyz);
        let pixelRadius = radius * params.projectionScale * params.viewportHeight * 0.5 / max(depth, 0.001);
        if (pixelRadius < params.minPixelRadius) { return; }
    }

    let outputIndex = atomicAdd(&drawArgs.instanceCount, 1u);
    let rotationY = time * 0.5 + i * 0.1;
    let cosY = cos(rotationY);
    let sinY = sin(rotationY);
    let base = outputIndex * 4u;
    visibleMatrices[base] = vec4<f32>(scale * cosY, 0.0, scale * -sinY, 0.0);
    visibleMatrices[base + 1u] = vec4<f32>(0.0, scale, 0.0, 0.0);
    visibleMatrices[base + 2u] = vec4<f32>(scale * sinY, 0.0, scale * cosY, 0.0);
    visibleMatrices[base + 3u] = vec4<f32>(center, 1.0);
    visibleColors[outputIndex] = instanceColor(index);
}
