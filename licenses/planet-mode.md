# Planet materials and sources

The planet material in `src/planet-shaders.js` is written for Multiverse Glass Match. Its procedural noise is computed in GLSL. Texture loading, caching and atlas integration are handled by `src/planet-assets.js` and `src/renderer.js`.

Earth textures are credited to NASA Visible Earth / Blue Marble. Moon, Mercury, Venus, Mars and Jupiter textures are credited to Solar System Scope / INOVE under CC BY 4.0. [Detailed file mapping and source links](../CREDITS.md#planet-rendering-and-textures)

The liquid-glass switch and spring are adapted from Zaki Sheriff's Liquid-Glass at commit `1f2142de02225d495c41bfb75acc41a3f807f940` under MIT. [License](Liquid-Glass.txt)
