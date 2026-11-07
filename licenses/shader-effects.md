# Black-hole lighting references

The lighting composition references Shader Effects Inc. / shaders at commit `9eb037d8db63a0783f67d58ce7291726d698933f`, under MIT. [Upstream](https://github.com/shader-effects-inc/shaders/tree/9eb037d8db63a0783f67d58ce7291726d698933f) · [License](shader-effects.txt)

- The luminous core and layered glow in `src/collision-shaders.js` reference `packages/core/src/shaders/LensFlare/index.ts`.
- Continuous world fusion uses the game's distance fields and atlas sampling. The event horizon, accretion band, local distortion and clearing timeline are implemented for this game.
- Otherworld black-hole colors are sampled from the live world atlas and cached for each fusion. Familiar planets use a warm palette.
- The fusion and black hole are bounded by the connected glass distance field and composited through its material.
