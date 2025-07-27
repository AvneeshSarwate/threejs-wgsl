
# Porting TouchDesigner drawing animation system to Babylon.js

1. Create test data for drawings - different lengths (circle, square, simplex noise)
2. write system that interpolates them into the same length and then stores them in a texture buffer
3. write the "launcher" system that passes the launch config to the compute shader 
   - launcher params
     - stroke A index
     - stroke B index
     - interpolation 
     - total duration
     - elapsed time
     - draw start point
     - draw size 
4. write a compute shader and babylon js scene that works in orthographic 2d coordinates like p5.js  
5. write the compute shader that reads the texture buffer and generates the drawing animation