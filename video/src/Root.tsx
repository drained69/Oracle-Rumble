import React from "react";
import { Composition } from "remotion";
import { DemoFilm } from "./film/Film";
import { DURATION_IN_FRAMES, FPS } from "./timeline";
import { PitchFilm } from "./pitch/PitchFilm";
import { DURATION_IN_FRAMES as PITCH_FRAMES, FPS as PITCH_FPS } from "./pitch/timeline";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="ThePitDemo" component={DemoFilm} durationInFrames={DURATION_IN_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="ThePitPitch" component={PitchFilm} durationInFrames={PITCH_FRAMES} fps={PITCH_FPS} width={1920} height={1080} defaultProps={{ narration: true }} />
  </>
);
