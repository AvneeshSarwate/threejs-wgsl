// Example Compute Shader

// uniform float exampleUniform;


#define POS 0
#define METADATA 1
#define DEBUG 2
#define STARTPOS 3
#define GESTURES 4
#define DISPLACE 5

#define MAX_GESTURES 10

uniform float triggered;
uniform float newestEvt;
uniform vec4 evt_time_map[1024];
uniform vec4 evt_extra_map[1024];
uniform float time;
uniform vec2 gestureDims;
uniform vec2 cam_frustum_size;
uniform float displace_strength;

layout (local_size_x = 32, local_size_y = 32) in;


float phaser(float pct, float phase, float e) {
  return clamp( (phase-1+pct*(1.+e))/e, 0., 1.);
}

vec2 uvN() {
    return vec2(gl_GlobalInvocationID.xy) / vec2(gl_NumWorkGroups.xy * gl_WorkGroupSize.xy);
}

int GroupID() {
    return int(gl_NumWorkGroups.x * gl_WorkGroupID.x + gl_WorkGroupID.y);
}

float WorkGroupFrac() {
    return float(gl_LocalInvocationIndex) / float(gl_WorkGroupSize.x * gl_WorkGroupSize.y);
}

int NumGroups() {
    return int(gl_NumWorkGroups.x * gl_NumWorkGroups.y);
}

int EventMod(float evt) {
    return int(evt) % NumGroups();
}

int NewestEvtMod() {
    return EventMod(newestEvt);
}

struct Particle{
    vec3 position;
    float isActive;
    float age;
    float lastAge;
    float evtInd;
    float evtType;
    vec2 startPos;
    float mixPair;
    float mixVal;
};

bool StartSpawnMulti() {
    return evt_time_map[GroupID()].a > 0.5;
}

void SpawnMulti(inout Particle p){
    p.position = vec3(evt_extra_map[GroupID()].xy, 0);
    p.evtInd = newestEvt;
    p.age = 0; //todo - init to actual event time?
    p.lastAge = time;
    p.isActive = 1;
    p.evtType = 1;
    p.startPos = evt_extra_map[GroupID()].xy;
    p.mixPair = evt_extra_map[GroupID()].z;
    p.mixVal = evt_extra_map[GroupID()].w;
}

bool IsActive(Particle p){
    return p.isActive == 1.;
}

vec3 SampleGesture(float gestureInd, float phaseVal) {
    float gestureRow = mod(gestureInd, gestureDims.y)/gestureDims.y;

    vec4 pos = texture(sTD2DInputs[GESTURES], vec2(phaseVal, gestureRow));
    vec4 gestureStart = texture(sTD2DInputs[GESTURES], vec2(0, gestureRow));

    return (pos.xyz - gestureStart.xyz);
}

vec3 SampleBlend(float mixPair, float mixVal, float phaseVal) {
    float ind1 = mod(mixPair, MAX_GESTURES);
    float ind2 = floor(mixPair/MAX_GESTURES);
    return mix(SampleGesture(ind1, phaseVal), SampleGesture(ind2, phaseVal), mixVal);
}

float map(float value, float min1, float max1, float min2, float max2) {
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

vec2 frustumPos_to_uv(vec2 frustumPos) {
    float mapX = clamp(map(frustumPos.x, -cam_frustum_size.x/2, cam_frustum_size.x/2, 0, 1), 0, 1);
    float mapY = clamp(map(frustumPos.y, -cam_frustum_size.y/2, cam_frustum_size.y/2, 0, 1), 0, 1);
    vec2 mapped = vec2(mapX, mapY);
    return mapped;
}

void EvolveMulti(inout Particle p){
    float phaseVal = clamp(phaser(p.age, WorkGroupFrac(), 1), 0, .9999);

    vec3 gesturePos;
    // gesturePos = SampleGesture(p.evtInd, phaseVal);
    // gesturePos = mix(SampleGesture(1, phaseVal), SampleGesture(2, phaseVal), 0.5);
    gesturePos = SampleBlend(p.mixPair, p.mixVal, phaseVal);

    vec2 uv = uvN();

    vec3 displace = texture(sTD2DInputs[DISPLACE], uv).rgb;
    displace = displace - 0.5;
    displace.z = 0;

    p.position = vec3(p.startPos, 0) + gesturePos;

    vec2 displace_uv = frustumPos_to_uv(p.position.xy);
    displace = texture(sTD2DInputs[DISPLACE], displace_uv).rgb;
    
    p.position += displace * displace_strength;
    int numGroups = NumGroups();
    p.lastAge = p.age;
    p.age = evt_time_map[GroupID()].y;
    p.isActive = float(p.age < 1.);
}

//Why doesn't this work with interpolated sampling for input?
Particle Read3(){
    Particle p;
    vec2 res = vec2((gl_NumWorkGroups * gl_WorkGroupSize).xy);
    vec2 uv = vec2(gl_GlobalInvocationID.xy) / res;

    int lod = 0;

    vec4 posAndActive = texelFetch(sTD2DInputs[POS], ivec2(gl_GlobalInvocationID.xy), lod);
    p.position = posAndActive.xyz;
    p.isActive = posAndActive.w;

    vec4 metaData = texelFetch(sTD2DInputs[METADATA], ivec2(gl_GlobalInvocationID.xy), lod);
    p.age = metaData.x;
    p.lastAge = metaData.y;
    p.evtInd = metaData.z;
    p.evtType = metaData.w;

    vec4 startPosAndMix = texelFetch(sTD2DInputs[STARTPOS], ivec2(gl_GlobalInvocationID.xy), lod);
    p.startPos = startPosAndMix.xy;
    p.mixPair = startPosAndMix.z;
    p.mixVal = startPosAndMix.w;

    return p;
}

void Write(Particle p){
    imageStore(mTDComputeOutputs[POS], ivec2(gl_GlobalInvocationID.xy), TDOutputSwizzle(vec4(p.position, p.isActive)));
    
    vec4 metaData = vec4(p.age, p.lastAge, p.evtInd, p.evtType);
    imageStore(mTDComputeOutputs[METADATA], ivec2(gl_GlobalInvocationID.xy), TDOutputSwizzle(metaData));

    float groupMatch = float(GroupID() == NewestEvtMod());
    float groupColor = float(GroupID()) / float(NumGroups());
    vec2 groupColor2 = vec2(float(gl_WorkGroupID.x) / float(gl_NumWorkGroups.x), float(gl_WorkGroupID.y) / float(gl_NumWorkGroups.y));
    vec4 debugInfo = vec4(triggered, groupMatch, groupColor, 1);
    // debugInfo = vec4(groupColor2, 0, 1);
    debugInfo = vec4(p.age, groupMatch, groupColor, p.evtType);
    imageStore(mTDComputeOutputs[DEBUG], ivec2(gl_GlobalInvocationID.xy), TDOutputSwizzle(debugInfo));

    imageStore(mTDComputeOutputs[STARTPOS], ivec2(gl_GlobalInvocationID.xy), TDOutputSwizzle(vec4(p.startPos, p.mixPair, p.mixVal)));
}

void main()
{
    //read particle
    Particle p = Read3();
    if(StartSpawnMulti()) {
        SpawnMulti(p);
    }
    if(IsActive(p)){
        EvolveMulti(p);
    } 

    Write(p);
}
