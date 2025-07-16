@group(0) @binding(0) var<storage, read_write> positionStorage: array<vec3f>;
@group(0) @binding(1) var<storage, read_write> velocityStorage: array<vec3f>;

//split-here
fn computeVelocity(
    index: u32,
    separation: f32,
    alignment: f32,
    cohesion: f32,
    deltaTime: f32,
    rayOrigin: vec3f,
    rayDirection: vec3f,
    numBirds: u32
) {
    // Define consts
    let PI = 3.141592653589793;
    let PI_2 = PI * 2.0;
    let limit = 9.0; // SPEED_LIMIT
    
    let zoneRadius = separation + alignment + cohesion;
    let separationThresh = separation / zoneRadius;
    let alignmentThresh = (separation + alignment) / zoneRadius;
    let zoneRadiusSq = zoneRadius * zoneRadius;
    
    // Cache current bird's position and velocity
    let position = positionStorage[index];
    var velocity = velocityStorage[index];
    var velocityLimit = limit;
    
    // Add influence of pointer position to velocity
    let directionToRay = rayOrigin - position;
    let projectionLength = dot(directionToRay, rayDirection);
    let closestPoint = rayOrigin - rayDirection * projectionLength;
    let directionToClosestPoint = closestPoint - position;
    let distanceToClosestPoint = length(directionToClosestPoint);
    let distanceToClosestPointSq = distanceToClosestPoint * distanceToClosestPoint;
    
    let rayRadius = 150.0;
    let rayRadiusSq = rayRadius * rayRadius;
    
    if (distanceToClosestPointSq < rayRadiusSq) {
        let velocityAdjust = (distanceToClosestPointSq / rayRadiusSq - 1.0) * deltaTime * 100.0;
        velocity += normalize(directionToClosestPoint) * velocityAdjust;
        velocityLimit += 5.0;
    }
    
    // Attract flocks to center
    var dirToCenter = position;
    dirToCenter.y *= 2.5;
    velocity -= normalize(dirToCenter) * deltaTime * 5.0;
    
    // Loop through all other birds
    for (var i = 0u; i < numBirds; i++) {
        if (i == index) {
            continue;
        }
        
        // Cache bird's position
        let birdPosition = positionStorage[i];
        let dirToBird = birdPosition - position;
        let distToBird = length(dirToBird);
        
        if (distToBird < 0.0001) {
            continue;
        }
        
        let distToBirdSq = distToBird * distToBird;
        
        // Don't apply changes if bird is outside zone radius
        if (distToBirdSq /*cmp*/ > zoneRadiusSq) {
            continue;
        }
        
        // Determine which threshold the bird is flying within
        let percent = distToBirdSq / zoneRadiusSq;
        
        if (percent < separationThresh) {
            // Separation - Move apart for comfort
            let velocityAdjust = (separationThresh / percent - 1.0) * deltaTime;
            velocity -= normalize(dirToBird) * velocityAdjust;
        } else if (percent < alignmentThresh) {
            // Alignment - fly the same direction
            let threshDelta = alignmentThresh - separationThresh;
            let adjustedPercent = (percent - separationThresh) / threshDelta;
            let birdVelocity = velocityStorage[i];
            
            let cosRange = cos(adjustedPercent * PI_2);
            let cosRangeAdjust = 0.5 - cosRange * 0.5 + 0.5;
            let velocityAdjust = cosRangeAdjust * deltaTime;
            velocity += normalize(birdVelocity) * velocityAdjust;
        } else {
            // Attraction / Cohesion - move closer
            let threshDelta = 1.0 - alignmentThresh;
            let adjustedPercent = select(1.0, (percent - alignmentThresh) / threshDelta, threshDelta != 0.0);
            
            let cosRange = cos(adjustedPercent * PI_2);
            let adj1 = cosRange * -0.5;
            let adj2 = adj1 + 0.5;
            let adj3 = 0.5 - adj2;
            
            let velocityAdjust = adj3 * deltaTime;
            velocity += normalize(dirToBird) * velocityAdjust;
        }
    }
    
    if (length(velocity) /*cmp*/ > velocityLimit) {
        velocity = normalize(velocity) * velocityLimit;
    }
    
    // Write back the final velocity to storage
    velocityStorage[index] = velocity;
}
