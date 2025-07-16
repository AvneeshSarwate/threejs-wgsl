Files where string replacement/normalization happens:

node_modules/three/src/renderers/webgpu/nodes/WGSLNodeFunction.js (contains the regex bug)
node_modules/three/src/nodes/code/FunctionNode.js (calls the parser)


Files where final shader is created/compiled:

node_modules/three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js (assembles full shader)
node_modules/three/src/renderers/webgpu/WebGPUBackend.js (final compilation to GPU)