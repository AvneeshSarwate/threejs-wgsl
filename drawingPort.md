
# Porting TouchDesigner drawing animation system to Babylon.js


This is the plan for recreating a system that takes and drawn 2d strokes and animates multiple instances of them using compute shaders and Babylon.js. It represents strokes as a series of points and draws them with instanced circles. it can interpolate between different strokes. It uses a single compute shader to manage multiple stroke-draw instances. 

1. Create test data generator for strokes since we don't have the handwriting input system hooked up - different lengths (circle, square, simplex noise) - output coordinates of the test strokes is in the domain.
2. write a compute shader and babylon js scene that works in orthographic 2d coordinates like p5.js (compute shader ouputs transforms and points in canvas coords, eg relative to 1280x720 canvas)
3. write system that interpolates cpu side stroke data of different strokes and them into the same length and then stores them in a texture buffer.
4. write the "launcher" system that passes the launch config to the compute shader drawing system.
   - launcher params
     - stroke A index
     - stroke B index
     - interpolation 
     - total duration
     - elapsed time
     - draw start point (canvas coords, eg relative to 1280x720 canvas)
     - draw size (canvas coords, eg relative to 1280x720 canvas)
     - active
  Each launch config is for a single stroke, and the system can handle up to 1024 simultaneous strokes. the input configs will be stored in a struct buffer.
  There will be a DrawLifecycleManager class that utilizes priority queue to manage the launch configs. It will have an addAnimation() class method that will add a new launch config to the priority queue, and a tick() method that updates the elapsed time for all properties as necessary, and removes completed animations from the queue.
5. write the compute shader that reads the texture buffer and generates the drawing animation.
    an example of an old version of this compute shader is in example_drawing_compute.glsl.