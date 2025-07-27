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
            <div class="control-group">
                <label>System Status:</label>
                <div id="status">Initializing...</div>
            </div>
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
            margin-bottom: 8px;
        }
        
        .control-group label {
            display: block;
            font-weight: bold;
            margin-bottom: 4px;
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
