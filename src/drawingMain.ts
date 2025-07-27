import { DrawingScene } from './drawing/drawingScene';
import Stats from './stats';

export async function drawingMain() {
    //@ts-expect-error
    const stats = new Stats();
    stats.showPanel(0);
    document.body.appendChild(stats.dom);

    // Create canvas element
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = `
        <canvas id="renderCanvas" width="1280" height="720"></canvas>
        <div id="info">
            <strong>Hand-drawn Stroke Animation System</strong><br>
            Click on canvas to launch stroke animations<br>
            Press 'C' to clear all animations
        </div>
        <div id="controls">
            <h4>Launch Parameters</h4>
            <div class="control-group">
                <label>Stroke A:</label>
                <input id="strokeA" type="number" min="0" max="11" value="0">
            </div>
            <div class="control-group">
                <label>Stroke B:</label>
                <input id="strokeB" type="number" min="0" max="11" value="1">
            </div>
            <div class="control-group">
                <label>Interpolation t:</label>
                <input id="interp" type="range" min="0" max="1" step="0.01" value="0.5">
                <span id="interpValue">0.5</span>
            </div>
            <div class="control-group">
                <label>Duration (s):</label>
                <input id="duration" type="number" min="0.1" max="10" step="0.1" value="2.0">
            </div>
            <div class="control-group">
                <label>Scale:</label>
                <input id="scale" type="number" min="0.1" max="3" step="0.1" value="1.0">
            </div>
            <div class="control-group">
                <label>Position:</label>
                <select id="position">
                    <option value="start">Start at click</option>
                    <option value="center" selected>Center at click</option>
                    <option value="end">End at click</option>
                </select>
            </div>
            <hr>
            <div class="control-group">
                <label>System Status:</label>
                <div id="status">Initializing...</div>
            </div>
            <hr>
            <div class="control-group">
                <label>Debug:</label>
                <button id="debugDraw">Draw Texture Data</button>
            </div>
        </div>
        <div id="debugCanvas" style="position: absolute; top: 500px; right: 0; z-index: 1000;  padding: 10px;">
            <h5 style="color: white; margin: 0 0 10px 0;">Debug: Stroke Texture Data</h5>
            <canvas id="debugCanvasElement" width="512" height="256" style="border: 1px solid #444;"></canvas>
        </div>
    `;

    // Add some basic styling
    const style = document.createElement('style');
    style.textContent = `
        #app {
            position: relative;
            font-family: Arial, sans-serif;
        }
        
        #renderCanvas {
            border: 1px solid #333;
            display: block;
            margin: 0 auto;
        }
        
        #info {
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-size: 14px;
            line-height: 1.4;
        }
        
        #controls {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
            min-width: 200px;
        }
        
        .control-group {
            margin-bottom: 10px;
        }
        
        .control-group label {
            display: block;
            font-weight: bold;
            margin-bottom: 4px;
        }
        
        .control-group input {
            width: 100%;
            padding: 4px;
            margin-bottom: 2px;
        }
        
        .control-group input[type="range"] {
            width: 80%;
        }
        
        h4 {
            margin: 0 0 10px 0;
            color: #4CAF50;
        }
        
        .error {
            color: #ff6b6b;
            font-weight: bold;
        }
        
        #status {
            font-family: monospace;
            font-size: 11px;
            line-height: 1.3;
        }
    `;
    document.head.appendChild(style);

    // Initialize the scene
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    const drawingScene = new DrawingScene();

    try {
        await drawingScene.createScene(canvas, stats);
        
        // Update status display periodically
        const statusElement = document.getElementById('status');
        if (statusElement) {
            const updateStatus = () => {
                const status = drawingScene.getStatus();
                statusElement.innerHTML = `
                    Active: ${status.animations.activeCount}/${status.animations.maxCapacity}<br>
                    Queued: ${status.animations.queuedCount}<br>
                    Memory: ${(status.memory.totalBytes / 1024).toFixed(1)}KB<br>
                    Can accept: ${status.animations.canAcceptMore ? 'Yes' : 'No'}
                `;
            };
            
            updateStatus();
            setInterval(updateStatus, 1000);
        }
        
        // Wire up UI control updates
        const interpSlider = document.getElementById('interp') as HTMLInputElement;
        const interpValue = document.getElementById('interpValue') as HTMLSpanElement;
        if (interpSlider && interpValue) {
            interpSlider.addEventListener('input', () => {
                interpValue.textContent = parseFloat(interpSlider.value).toFixed(2);
            });
        }
        
        console.log('Drawing scene initialized successfully');
        
    } catch (error) {
        console.error('Failed to initialize drawing scene:', error);
        
        const infoElement = document.getElementById('info');
        if (infoElement) {
            if (!navigator.gpu) {
                infoElement.innerHTML = `
                    <span class="error">WebGPU is not available!</span><br>
                    This could be due to:<br>
                    • Browser doesn't support WebGPU<br>
                    • WebGPU is disabled in browser settings<br><br>
                    Try: Chrome/Edge 113+ or Safari Technology Preview
                `;
            } else {
                infoElement.innerHTML = `
                    <span class="error">WebGPU initialization failed!</span><br>
                    ${error instanceof Error ? error.message : String(error)}
                `;
            }
        }
    }
}
