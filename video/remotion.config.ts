import { Config } from "@remotion/cli/config";

// High-quality intermediate frames so the H.264 encode starts from clean pixels.
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer("angle");
// Optional: render with an installed Chrome instead of Remotion's downloaded
// headless shell, e.g. REMOTION_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".
if (process.env.REMOTION_BROWSER) Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
