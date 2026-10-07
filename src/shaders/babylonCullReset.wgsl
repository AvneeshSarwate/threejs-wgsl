struct DrawArgs {
    indexCount: u32,
    instanceCount: atomic<u32>,
    firstIndex: u32,
    baseVertex: i32,
    firstInstance: u32,
};

@group(0) @binding(0) var<storage, read_write> drawArgs: DrawArgs;

@compute @workgroup_size(1)
fn main() {
    atomicStore(&drawArgs.instanceCount, 0u);
}
