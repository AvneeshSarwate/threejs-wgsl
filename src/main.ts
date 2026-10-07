// import { threeBoidsInit } from "./threeBoidsScene";
// import { babylonInit } from "./babylonScene";
import { babylonInit_noCopy } from "./babylonScene_noCopy";
import { babylonInit_gpuCull } from "./babylonScene_gpuCull";
// import { babylonBoidsInit } from "./babylonBoids";
// import { babylon2DInit } from "./babylon2DScene";
// import { drawingMain } from "./drawingMain";

// threeBoidsInit();
// babylonInit();
if (new URLSearchParams(location.search).get('scene') === 'noCopy') {
  babylonInit_noCopy();
} else {
  void babylonInit_gpuCull();
}
// babylonBoidsInit();
// babylon2DInit();
// drawingMain();
