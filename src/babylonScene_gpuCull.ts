import * as BABYLON from 'babylonjs';
import Stats from './stats';
import './babylonStyle.css';
import cullSource from './shaders/babylonOscillateCompute_gpuCull.wgsl?raw';
import resetSource from './shaders/babylonCullReset.wgsl?raw';

const INSTANCE_COUNT = 1_000_000;
const GRID_SIZE = Math.ceil(Math.sqrt(INSTANCE_COUNT));
const DISC_RADIUS = 0.12;

/** GPU-only compaction and indirect drawing. Query parameters: radius, minPixelRadius, cull=frustum|size. */
export async function createGpuCullScene(canvas: HTMLCanvasElement, stats: Stats): Promise<BABYLON.WebGPUEngine> {
    if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser');
    const query = new URLSearchParams(location.search);
    const radius = Number(query.get('radius') ?? 20);
    const minPixelRadius = Number(query.get('minPixelRadius') ?? 0.5);
    const sizeCull = query.get('cull') !== 'frustum';

    // Babylon filters unsupported requested features before creating the device.
    // Timestamp queries are optional, but its GPU frame timer needs one enabled.
    const engine = new BABYLON.WebGPUEngine(canvas, {
        deviceDescriptor: { requiredFeatures: ['timestamp-query'] },
    });
    await engine.initAsync();
    const gpuTimingSupported = engine.enabledExtensions.includes('timestamp-query');
    // Pass timestamps work on browsers where Babylon's whole-frame encoder
    // timestamps produce no samples.
    if (gpuTimingSupported) engine.enableGPUTimingMeasurements = true;
    // Babylon only uses its indirect draw buffer in this mode.
    engine.compatibilityMode = false;
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.1, 1);
    const camera = new BABYLON.ArcRotateCamera('camera', Math.PI / 2, Math.PI / 2.5,
        Number.isFinite(radius) ? radius : 20, BABYLON.Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 300;
    const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.8;

    const visibleMatrices = new BABYLON.StorageBuffer(engine, INSTANCE_COUNT * 64,
        BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | BABYLON.Constants.BUFFER_CREATIONFLAG_STORAGE);
    const visibleColors = new BABYLON.StorageBuffer(engine, INSTANCE_COUNT * 16,
        BABYLON.Constants.BUFFER_CREATIONFLAG_VERTEX | BABYLON.Constants.BUFFER_CREATIONFLAG_STORAGE);
    const drawArgs = new BABYLON.StorageBuffer(engine, 20,
        BABYLON.Constants.BUFFER_CREATIONFLAG_STORAGE |
        BABYLON.Constants.BUFFER_CREATIONFLAG_INDIRECT |
        BABYLON.Constants.BUFFER_CREATIONFLAG_WRITE |
        BABYLON.Constants.BUFFER_CREATIONFLAG_READ);

    const circle = BABYLON.MeshBuilder.CreateDisc('circle', { radius: DISC_RADIUS, tessellation: 32 }, scene);
    circle.alwaysSelectAsActiveMesh = true;
    const material = new BABYLON.StandardMaterial('mat', scene);
    material.diffuseColor = BABYLON.Color3.White();
    material.specularColor = new BABYLON.Color3(1, 0.5, 0.1);
    material.emissiveColor = new BABYLON.Color3(0.5, 0.2, 0.1);
    material.specularPower = 64;
    circle.material = material;
    circle.thinInstanceSetBuffer('matrix', null, 16);
    circle.thinInstanceCount = INSTANCE_COUNT;
    circle.forcedInstanceCount = INSTANCE_COUNT;
    circle.manualUpdateOfWorldMatrixInstancedBuffer = true;

    for (let column = 0; column < 4; column++) {
        circle.setVerticesBuffer(new BABYLON.VertexBuffer(engine, visibleMatrices.getBuffer(),
            `world${column}`, false, false, 16, true, column * 4, 4));
    }
    circle.setVerticesBuffer(new BABYLON.VertexBuffer(engine, visibleColors.getBuffer(),
        'color', false, false, 4, true, 0, 4));

    const indexCount = circle.getTotalIndices();
    drawArgs.update(new Uint32Array([indexCount, 0, 0, 0, 0]));
    const rawArgs = (drawArgs.getBuffer() as BABYLON.WebGPUDataBuffer).underlyingResource as GPUBuffer;
    const originalIndirectBuffers = new Map<BABYLON.WebGPUDrawContext, GPUBuffer>();
    // Babylon's draw context owns the draw call, pipeline and vertex bindings. Its public
    // indirectDrawBuffer points the draw at the same GPU buffer that the compute pass updates.
    // Seed Babylon's CPU-side count cache on its original buffer before swapping it; this
    // prevents setIndirectData from overwriting the GPU-produced count during each draw.
    circle.onBeforeDrawObservable.add(() => {
        const context = engine._currentDrawContext;
        if (context.indirectDrawBuffer !== rawArgs) {
            if (!context.indirectDrawBuffer) {
                throw new Error('Babylon did not enable indirect instancing for the culling draw');
            }
            context.setIndirectData(indexCount, INSTANCE_COUNT, 0);
            originalIndirectBuffers.set(context, context.indirectDrawBuffer);
            context.indirectDrawBuffer = rawArgs;
        }
    });
    circle.onDisposeObservable.add(() => {
        for (const [context, original] of originalIndirectBuffers) {
            context.indirectDrawBuffer = original;
        }
        originalIndirectBuffers.clear();
    });

    const params = new BABYLON.UniformBuffer(engine);
    for (const name of ['time', 'instanceCount', 'gridSize', 'minPixelRadius',
        'viewportHeight', 'projectionScale', 'baseRadius', 'enableSizeCull']) {
        params.addUniform(name, 1);
    }
    for (const name of ['cameraPosition', 'cameraForward', 'frustumPlane0', 'frustumPlane1',
        'frustumPlane2', 'frustumPlane3', 'frustumPlane4', 'frustumPlane5']) {
        params.addUniform(name, 4);
    }
    params.updateUInt('instanceCount', INSTANCE_COUNT);
    params.updateFloat('gridSize', GRID_SIZE);
    params.updateFloat('minPixelRadius', Number.isFinite(minPixelRadius) ? Math.max(0, minPixelRadius) : 0.5);
    params.updateFloat('baseRadius', DISC_RADIUS);
    params.updateFloat('enableSizeCull', sizeCull ? 1 : 0);

    const reset = new BABYLON.ComputeShader('resetIndirectCount', engine,
        { computeSource: resetSource }, { bindingsMapping: { drawArgs: { group: 0, binding: 0 } } });
    reset.setStorageBuffer('drawArgs', drawArgs);
    const cull = new BABYLON.ComputeShader('oscillateAndCull', engine,
        { computeSource: cullSource }, { bindingsMapping: {
            visibleMatrices: { group: 0, binding: 0 },
            visibleColors: { group: 0, binding: 1 },
            drawArgs: { group: 0, binding: 2 },
            params: { group: 0, binding: 3 },
        } });
    cull.setStorageBuffer('visibleMatrices', visibleMatrices);
    cull.setStorageBuffer('visibleColors', visibleColors);
    cull.setStorageBuffer('drawArgs', drawArgs);
    cull.setUniformBuffer('params', params);
    while (!reset.isReady() || !cull.isReady()) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    const planes = Array.from({ length: 6 }, () => new BABYLON.Plane(0, 0, 0, 0));
    const metrics = document.getElementById('metrics');
    const postCullCount = document.getElementById('postCullCount');
    let frames = 0;
    let frameTimeTotal = 0;
    let reading = false;
    const gpu = new BABYLON.EngineInstrumentation(engine);
    gpu.captureGPUFrameTime = true;

    const device = engine._device;
    const staging = device.createBuffer({ size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    let samplingEnabled = true;
    const countObserver = engine.onEndFrameObservable.add(() => {
        if (reading || !samplingEnabled) return;
        reading = true;
        // Babylon has submitted this frame's draw. Copy only the 4-byte count
        // into a reusable staging buffer, then map it asynchronously. Never
        // wait for the GPU in the render callback.
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(rawArgs, 4, staging, 0, 4);
        device.queue.submit([encoder.finish()]);
        void staging.mapAsync(GPUMapMode.READ).then(() => {
            const count = new DataView(staging.getMappedRange()).getUint32(0, true);
            staging.unmap();
            if (postCullCount) postCullCount.textContent = count.toLocaleString();
        }).catch(error => {
            samplingEnabled = false;
            if (postCullCount) postCullCount.textContent = 'unavailable';
            console.error('Post-cull count sample failed:', error);
        }).finally(() => { reading = false; });
    });
    scene.onDisposeObservable.add(() => {
        engine.onEndFrameObservable.remove(countObserver);
        staging.destroy();
    });

    scene.registerBeforeRender(() => {
        params.updateFloat('time', performance.now() * 0.001);
        params.updateFloat('viewportHeight', engine.getRenderHeight(true));
        params.updateFloat('projectionScale', camera.getProjectionMatrix().m[5]);
        const position = camera.globalPosition;
        const forward = camera.getForwardRay().direction;
        params.updateFloat4('cameraPosition', position.x, position.y, position.z, 0);
        params.updateFloat4('cameraForward', forward.x, forward.y, forward.z, 0);
        BABYLON.Frustum.GetPlanesToRef(scene.getTransformMatrix(), planes);
        planes.forEach((plane, i) => {
            const length = plane.normal.length();
            params.updateFloat4(`frustumPlane${i}`, plane.normal.x / length,
                plane.normal.y / length, plane.normal.z / length, plane.d / length);
        });
        params.update();
        reset.dispatch(1, 1, 1);
        cull.dispatch(Math.ceil(INSTANCE_COUNT / 64), 1, 1);
    });

    engine.runRenderLoop(() => {
        stats.begin();
        const start = performance.now();
        scene.render();
        frameTimeTotal += performance.now() - start;
        frames++;
        stats.end();
        if (frames % 60 === 0 && metrics) {
            const sampleNs = (counter?: BABYLON.PerfCounter): number | null => {
                if (!counter || counter.count === 0) return null;
                const value = counter.lastSecAverage > 0 ? counter.lastSecAverage : counter.current;
                return Number.isFinite(value) && value > 0 ? value : null;
            };
            const frameNs = sampleNs(gpu.gpuFrameTimeCounter);
            const passTimes = [reset.gpuTimeInFrame?.counter,
                cull.gpuTimeInFrame?.counter, engine.gpuTimeInFrameForMainPass?.counter]
                .map(sampleNs);
            const passNs = passTimes.every(value => value !== null)
                ? passTimes.reduce<number>((sum, value) => sum + value!, 0) : null;
            const timing = !gpuTimingSupported ? 'unsupported' : frameNs !== null
                ? `frame ${(frameNs / 1_000_000).toFixed(2)} ms`
                : passNs !== null ? `passes ${(passNs / 1_000_000).toFixed(2)} ms`
                : frames < 180 ? 'starting' : 'no samples from browser';
            metrics.textContent = `GPU cull (${sizeCull ? 'frustum + size' : 'frustum'}) | radius ${camera.radius.toFixed(1)} | ` +
                `FPS ${engine.getFps().toFixed(1)} | CPU ${ (frameTimeTotal / 60).toFixed(2) } ms | ` +
                `GPU timing ${timing}`;
            frameTimeTotal = 0;
        }
    });
    window.addEventListener('resize', () => engine.resize());
    return engine;
}

export async function babylonInit_gpuCull(): Promise<void> {
    // @ts-expect-error stats.js is a local JavaScript module without declarations.
    const stats = new Stats();
    stats.showPanel(0);
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = '<canvas id="renderCanvas" width="1280" height="720"></canvas>' +
        '<div id="info"><div id="metrics">Initializing GPU culling…</div>' +
        `<div>Pre-cull: ${INSTANCE_COUNT.toLocaleString()} | Post-cull: <span id="postCullCount">sampling…</span></div></div>`;
    try {
        await createGpuCullScene(document.getElementById('renderCanvas') as HTMLCanvasElement, stats);
    } catch (error) {
        console.error('Failed to initialize GPU culling scene:', error);
        document.getElementById('info')!.textContent = String(error);
    }
}
