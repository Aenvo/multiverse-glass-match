# Credits and sources

Multiverse Glass Match is a non-commercial project by Aenvo. The artists and developers below supplied shader artwork, textures, code or rendering references. Their individual terms are linked in [LICENSE.md](LICENSE.md).

## Orbkit shader worlds

The 33 Orbkit appearances, idle presets and shared GLSL helpers in `src/vendor/orbkit.js` are adapted from zzzzshawn's Orbkit at commit `5dbd641ee0d08a9135a2c13b75c4685c36b02150`. The port uses GLSL ES 3.0 and a shared WebGL2 atlas, with uniforms and shader previews integrated into the game. Original per-shader notices are retained.

The upstream documents describe non-commercial use with attribution and provide installation and source-copying instructions. The exact ported-shader license text is preserved alongside the MIT license. [Orbkit source](https://github.com/zzzzshawn/orbkit/tree/5dbd641ee0d08a9135a2c13b75c4685c36b02150) · [Official usage and licensing](https://orbkit.zzzzshawn.cloud/getting-started/introduction) · [Upstream credits](https://github.com/zzzzshawn/orbkit/blob/5dbd641ee0d08a9135a2c13b75c4685c36b02150/CREDITS.md)

| Author | Appearances | Terms |
| --- | --- | --- |
| XorDev | SHDR-01–10, SHDR-15, SHDR-18–20, SHDR-22, SHDR-25–26, SHDR-28, SHDR-31 | Non-commercial use with attribution and retained notices. Preserve the complete [ported-shader terms](licenses/Orbkit-shaders.md). |
| zzzzshawn | SHDR-11–14, SHDR-16–17, SHDR-21, SHDR-23–24, SHDR-27, SHDR-29–30, SHDR-32–33, shared runtime and helpers | [MIT](licenses/Orbkit.txt) |

Credit XorDev as the original shader artist and zzzzshawn as the Orbkit author when redistributing these adaptations. [XorDev](https://x.com/XorDev) · [zzzzshawn](https://github.com/zzzzshawn)

## Planet rendering and textures

`src/planet-shaders.js` contains planet materials written for this project. It uses sphere projection, surface-texture sampling, lighting, clouds, atmospheric edges and arithmetic procedural noise. Azure world is the fictional WORLD-01 appearance in Otherworld Mode.

Julien Sulpis's realtime-planet-shader was a visual research reference during development. Its demonstrations helped establish the intended appearance of textured planets and atmosphere. The current planet material is implemented in this project's shader module. [Julien Sulpis's project](https://github.com/jsulpis/realtime-planet-shader/tree/cfa2776033d31250bb826b677e4539c4cecbd4be)

The texture files were obtained through that project's public asset collection at commit `cfa2776033d31250bb826b677e4539c4cecbd4be`. Texture permissions follow their original providers.

| Files in `assets/planets/` | Source and author | Terms |
| --- | --- | --- |
| `2k_earth_color.jpeg`, `2k_earth_night.jpeg`, `2k_earth_clouds.jpeg`, `2k_earth_specular.jpeg`, `2k_earth_bump.jpg` | NASA Visible Earth / Blue Marble, as credited by the upstream Earth page | NASA media usage guidelines and source acknowledgment |
| `2k_moon.jpeg` | Solar System Scope / INOVE | CC BY 4.0 |
| `2k_mercury.jpg` | Solar System Scope / INOVE | CC BY 4.0 |
| `2k_venus.jpg` | Solar System Scope / INOVE | CC BY 4.0 |
| `2k_mars.jpg` | Solar System Scope / INOVE | CC BY 4.0 |
| `2k_jupiter.jpg` | Solar System Scope / INOVE | CC BY 4.0 |

Source texture files retain their supplied bytes. At runtime, the image loader resizes them to 512 × 256 and flips the vertical axis for spherical mapping. Shaders adjust lighting and composite the textures into liquid glass. Please credit **Solar System Scope / INOVE** and **NASA Visible Earth / Blue Marble** with the applicable links when reusing these assets. [Solar System Scope textures](https://www.solarsystemscope.com/textures/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [NASA Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble) · [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) · [Upstream Earth credit](https://github.com/jsulpis/realtime-planet-shader/blob/cfa2776033d31250bb826b677e4539c4cecbd4be/src/pages/earth.astro)

## Liquid-glass rendering

- **NaughtyDuk / liquidGL** informed glass sampling and highlights in `src/shaders.js`. Source commit `88f681ab7035fd55b04f63edff1841e32c4199e9`. Retain the supplied MIT license and its asset exclusions. [Source](https://github.com/naughtyduk/liquidGL/blob/88f681ab7035fd55b04f63edff1841e32c4199e9/package/liquidGL.js) · [License](licenses/liquidGL.txt)
- **ybouane / liquidglass** informed the bevel height field and approximate refraction through two glass surfaces in `src/shaders.js`. Source commit `59af227103795f06421a96e2c7d3dceb081decd2`. The upstream README and package manifest declare MIT. [Source](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/shaders.ts) · [Source and license record](licenses/liquidglass.txt)
- **Zaki Sheriff / Liquid-Glass** supplied the spring and switch implementation adapted in `src/vendor/liquid-glass-spring.js`, `src/planet-switch.js` and the switch section of `src/style.css`. Source commit `1f2142de02225d495c41bfb75acc41a3f807f940`. The port removes TypeScript annotations and adapts the gesture, lens, edge displacement and rebound to the game's DOM. [Source](https://github.com/zakisheriff/Liquid-Glass/tree/1f2142de02225d495c41bfb75acc41a3f807f940) · [MIT license](licenses/Liquid-Glass.txt)

## Black-hole lighting

**Shader Effects Inc. / shaders**, commit `9eb037d8db63a0783f67d58ce7291726d698933f`, informed layered glow and luminous-core composition in `src/collision-shaders.js` through its LensFlare shader. Connected-glass fusion, the event horizon, accretion band, collapse timing and per-fusion sampled palette are implemented in this project. [Source](https://github.com/shader-effects-inc/shaders/tree/9eb037d8db63a0783f67d58ce7291726d698933f) · [MIT license](licenses/shader-effects.txt) · [Adaptation notes](licenses/shader-effects.md)
