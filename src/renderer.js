import { orbTypes } from "./orb-types.js";
import { atlasVertex, coreFragment, fusionFragment, glassFragment, MAX_TILES, sceneFragment, tileVertex } from "./shaders.js";
import { orbVariants } from "./vendor/orbkit.js";
import { loadPlanetAssets } from "./planet-assets.js";
import { texturesFor } from "./planet-types.js";
import { collisionGeometry } from "./planet-collision.js";
import { collisionFragment, collisionVertex, paletteFragment } from "./collision-shaders.js";

const ATLAS_SIZE = 144;
const PALETTE_SIZE = 16;
const TILE_STRIDE = 16;
const IDLE_OUTPUT = 0.3;
const IDLE_FLOW = 0.1 + (1 - (IDLE_OUTPUT - 1) ** 2) * 0.9;

function makePreset(type) {
  if (type.kind === "planet") return type;
  const { field, phase } = type;
  const variant = orbVariants[field];
  return {
    field,
    params: Object.entries(variant.params).map(([key, value], index) => [
      `uP_${key}`, value, variant.clocks.includes(key) ? (phase * 4.7 + index * 13.17) % 100 : null,
    ]),
    colors: Object.entries(variant.colors).map(([key, value]) => [`uC_${key}`, rgb(value)]),
  };
}
const atlasSlots = orbTypes.map((_, slot) => slot);

function rgb(hex) {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
}

function smooth(from, to, value) {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error);
  }
  return shader;
}

function program(gl, vertex, fragment) {
  const handle = gl.createProgram();
  let vs;
  let fs;
  try {
    vs = compile(gl, gl.VERTEX_SHADER, vertex);
    fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(handle, vs);
    gl.attachShader(handle, fs);
    gl.linkProgram(handle);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle));
  } catch (error) {
    gl.deleteProgram(handle);
    throw error;
  } finally {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
  }

  const uniforms = {};
  const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index++) {
    const { name } = gl.getActiveUniform(handle, index);
    uniforms[name.replace(/\[0\]$/, "")] = gl.getUniformLocation(handle, name);
  }
  return { handle, uniforms };
}

function target(gl) {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture, framebuffer };
}

function sizeTarget(gl, { texture, framebuffer }, width, height) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Glass framebuffer is incomplete.");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

export class GlassRenderer {
  constructor(canvas, types = orbTypes) {
    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,
    });
    if (!gl) throw new Error("This game requires WebGL2.");

    this.canvas = canvas;
    this.gl = gl;
    this.valid = true;
    this.planetSources = new Map();
    this.planetTextures = new Map();
    this.presets = types.map(makePreset);
    this.extents = new Float32Array(types.map(({ extent }) => extent));
    this.orbs = Object.fromEntries(this.presets.map(({ field }) =>
      [field, program(gl, atlasVertex, orbVariants[field].fragment)]));
    this.scene = program(gl, tileVertex, sceneFragment);
    this.cores = program(gl, tileVertex, coreFragment);
    this.glass = program(gl, tileVertex, glassFragment);
    this.collisionField = program(gl, collisionVertex, collisionFragment);
    this.collisionOrbs = program(gl, tileVertex, fusionFragment);
    this.paletteShader = program(gl, atlasVertex, paletteFragment);
    this.atlas = target(gl);
    sizeTarget(gl, this.atlas, ATLAS_SIZE * this.presets.length, ATLAS_SIZE);
    this.surface = target(gl);
    this.backdrop = null;
    this.orbTime = 0;
    this.night = 0;
    this.lastFrameTime = null;
    this.lastAtlasTick = -Infinity;
    this.atlasTurn = 0;
    this.collisionGroups = new Map();
    this.instanceData = new Float32Array(MAX_TILES * TILE_STRIDE);
    this.instances = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    for (let attribute = 0; attribute < 4; attribute++) {
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, TILE_STRIDE * 4, attribute * 16);
      gl.vertexAttribDivisor(attribute, 1);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DITHER);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.glass.handle);
    gl.uniform1i(this.glass.uniforms.uScene, 0);
    gl.uniform1i(this.glass.uniforms.uAtlas, 1);
    gl.uniform1i(this.glass.uniforms.uBackdrop, 2);
    gl.useProgram(this.cores.handle);
    gl.uniform1i(this.cores.uniforms.uAtlas, 1);
  }

  resize(width, height, deviceScale) {
    const ratio = Math.min(deviceScale, 2, Math.sqrt(5_500_000 / (width * height)));
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (this.width === width && this.height === height
      && this.canvas.width === pixelWidth && this.canvas.height === pixelHeight) return;

    this.width = width;
    this.height = height;
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.sceneWidth = Math.max(1, Math.round(width * Math.min(ratio, 1.2)));
    this.sceneHeight = Math.max(1, Math.round(height * Math.min(ratio, 1.2)));
    sizeTarget(this.gl, this.surface, this.sceneWidth, this.sceneHeight);
    if (this.backdrop) sizeTarget(this.gl, this.backdrop, this.sceneWidth, this.sceneHeight);
  }

  render(tiles, fusions, time, night = 0, reducedMotion = false) {
    const gl = this.gl;
    this.night = night;
    this.reducedMotion = reducedMotion;
    const collisions = fusions;
    this.prepareCollisions(collisions);
    const dt = this.lastFrameTime === null ? 0 : Math.min(0.05, Math.max(0, time - this.lastFrameTime));
    this.lastFrameTime = time;
    this.orbTime += dt;
    if (time - this.lastAtlasTick >= 1 / 75) {
      const slots = Number.isFinite(this.lastAtlasTick)
        ? atlasSlots.filter(slot => slot !== this.atlasTurn % atlasSlots.length)
        : atlasSlots;
      this.renderAtlas(slots);
      this.atlasTurn++;
      this.lastAtlasTick = time;
    }
    this.captureCollisionColors(collisions);

    this.uploadTiles(tiles);
    const merges = fusions.map(fusion => this.mergeUniforms(fusion));
    if (collisions.length) this.drawCollisions(collisions);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.collisionMatter?.texture ?? null);
    const { width, height } = this.canvas;
    gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.surface.framebuffer);
    const backdrop = 1 - night;
    gl.clearColor(backdrop, backdrop, backdrop, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    this.draw(this.scene, tiles.length, merges, time, night);
    // During the theme transition each material samples its own source.
    // The light material uses shadows; the dark material also refracts orbs.
    if (night > 0) {
      if (night < 1) {
        if (!this.backdrop) {
          this.backdrop = target(gl);
          sizeTarget(gl, this.backdrop, this.sceneWidth, this.sceneHeight);
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.surface.framebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.backdrop.framebuffer);
        gl.blitFramebuffer(0, 0, this.sceneWidth, this.sceneHeight,
          0, 0, this.sceneWidth, this.sceneHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.surface.framebuffer);
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
      this.draw(this.cores, tiles.length, merges, time, night);
    }

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.surface.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.sceneWidth, this.sceneHeight, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D,
      night > 0 && night < 1 ? this.backdrop.texture : this.surface.texture);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.surface.texture);
    this.draw(this.glass, tiles.length, merges, time, night);
  }

  prepareCollisions(fusions) {
    const gl = this.gl;
    const active = new Set(fusions.map(fusion => fusion.key));
    for (const key of this.collisionGroups.keys()) {
      if (!active.has(key)) this.collisionGroups.delete(key);
    }
    if (!fusions.length) return;
    if (!this.collisionSource) {
      this.collisionSource = target(gl);
      this.collisionMatter = target(gl);
    }
    if (this.collisionWidth !== this.sceneWidth || this.collisionHeight !== this.sceneHeight) {
      sizeTarget(gl, this.collisionSource, this.sceneWidth, this.sceneHeight);
      sizeTarget(gl, this.collisionMatter, this.sceneWidth, this.sceneHeight);
      this.collisionWidth = this.sceneWidth;
      this.collisionHeight = this.sceneHeight;
    }
    fusions.forEach((fusion, index) => {
      const previous = this.collisionGroups.get(fusion.key);
      if (previous?.width === this.width && previous?.height === this.height) return;
      this.collisionGroups.set(fusion.key, {
        geometry: collisionGeometry(fusion),
        paletteRow: previous?.paletteRow ?? index,
        captureColor: previous?.captureColor ?? (this.presets[fusion.type].kind !== "planet"
          || this.presets[fusion.type].source === "procedural"),
        width: this.width, height: this.height,
      });
    });
  }

  captureCollisionColors(fusions) {
    const pending = fusions.filter(fusion => this.collisionGroups.get(fusion.key).captureColor);
    if (!pending.length) return;
    const gl = this.gl;
    if (!this.collisionPalette) {
      this.collisionPalette = target(gl);
      sizeTarget(gl, this.collisionPalette, PALETTE_SIZE, MAX_TILES);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    }
    const { handle, uniforms } = this.paletteShader;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.collisionPalette.framebuffer);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.useProgram(handle);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.uniform1i(uniforms.uAtlas, 1);
    gl.uniform1fv(uniforms.uExtents, this.extents);
    for (const fusion of pending) {
      const group = this.collisionGroups.get(fusion.key);
      gl.viewport(0, group.paletteRow, PALETTE_SIZE, 1);
      gl.uniform1i(uniforms.uType, fusion.type);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      group.captureColor = false;
    }
  }

  collisionUniforms(shader, fusion, geometry) {
    const gl = this.gl;
    const { uniforms } = shader;
    gl.useProgram(shader.handle);
    gl.uniform2f(uniforms.uViewport, this.width, this.height);
    gl.uniform2fv(uniforms.uCenter ?? null, geometry.center);
    gl.uniform2fv(uniforms.uAxis ?? null, geometry.axis);
    gl.uniform4fv(uniforms.uBounds ?? null, geometry.bounds);
    gl.uniform1f(uniforms.uReach ?? null, geometry.reach);
    gl.uniform1f(uniforms.uRadius ?? null, fusion.radius);
    gl.uniform1f(uniforms.uProgress, fusion.progress);
    gl.uniform1i(uniforms.uReducedMotion ?? null, this.reducedMotion);
    gl.uniform1f(uniforms.uNight ?? null, this.night);
    gl.uniform1fv(uniforms.uExtents ?? null, this.extents);
    gl.uniform1i(uniforms.uAtlas ?? null, 1);
    gl.uniform1i(uniforms.uScene ?? null, 0);
    gl.uniform1i(uniforms.uPalette ?? null, 4);
    gl.uniform1f(uniforms.uPaletteRow ?? null, this.collisionGroups.get(fusion.key).paletteRow);
    gl.uniform1i(uniforms.uSampledColor ?? null, this.presets[fusion.type].kind !== "planet"
      || this.presets[fusion.type].source === "procedural");
    const merge = this.mergeUniforms(fusion);
    gl.uniform1i(uniforms.uMergeCount, merge.count);
    gl.uniform4fv(uniforms.uParts, merge.coordinates);
    gl.uniform1f(uniforms.uSpacing, merge.spacing);
    gl.uniform4fv(uniforms.uMerge, merge.shape);
    gl.uniform2fv(uniforms.uInner ?? null, merge.inner);
    gl.uniform2f(uniforms.uCentroid ?? null, merge.centerX, merge.centerY);
    gl.uniform1f(uniforms.uFusionPull ?? null, 0.24 * smooth(0.16, 0.54, fusion.progress));
  }

  drawCollisions(fusions) {
    const gl = this.gl;
    gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.collisionSource.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.bindVertexArray(this.vao);
    for (const fusion of fusions) {
      this.collisionUniforms(this.collisionOrbs, fusion, this.collisionGroups.get(fusion.key).geometry);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.collisionSource.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.collisionMatter.framebuffer);
    gl.blitFramebuffer(0, 0, this.sceneWidth, this.sceneHeight, 0, 0,
      this.sceneWidth, this.sceneHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.collisionMatter.framebuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.collisionSource.texture);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.collisionPalette?.texture ?? this.atlas.texture);
    gl.bindVertexArray(null);
    for (const fusion of fusions) {
      this.collisionUniforms(this.collisionField, fusion, this.collisionGroups.get(fusion.key).geometry);
      gl.uniform1i(this.collisionField.uniforms.uLayer, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    for (const fusion of fusions) {
      this.collisionUniforms(this.collisionField, fusion, this.collisionGroups.get(fusion.key).geometry);
      gl.uniform1i(this.collisionField.uniforms.uLayer, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  setOrbTypes(types) {
    for (const type of types) this.orbProgram(type);
    this.presets = types.map(makePreset);
    this.extents = new Float32Array(types.map(({ extent }) => extent));
    this.lastAtlasTick = -Infinity;
  }

  async prepareOrbTypes(types) {
    const assets = await loadPlanetAssets(types);
    const gl = this.gl;
    if (!this.valid || gl.isContextLost()) throw new Error("Graphics are being restored. Please try again shortly.");
    for (const [key, source] of assets.sources) this.planetSources.set(key, source);
    gl.activeTexture(gl.TEXTURE3);
    for (const [key, image] of assets.images) {
      if (this.planetTextures.has(key)) continue;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.planetTextures.set(key, texture);
    }
    for (const type of types) this.orbProgram(type);
  }

  orbProgram(type) {
    const key = type.kind === "planet" ? `planet-${type.source}` : type.field;
    const source = type.kind === "planet" ? this.planetSources.get(type.source) : orbVariants[type.field].fragment;
    if (!source) throw new Error("Planet assets are not ready");
    return this.orbs[key] ??= program(this.gl, atlasVertex, source);
  }

  renderAtlas(slots) {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.atlas.framebuffer);
    gl.disable(gl.BLEND);
    for (const index of slots) {
      gl.viewport(index * ATLAS_SIZE, 0, ATLAS_SIZE, ATLAS_SIZE);
      this.drawOrb(this.presets[index]);
    }
  }

  drawOrb(preset) {
    if (preset.kind === "planet") {
      this.drawPlanet(preset);
      return;
    }
    const { field, params, colors } = preset;
    const gl = this.gl;
    const shader = this.orbs[field] ??= program(gl, atlasVertex, orbVariants[field].fragment);
    const { handle, uniforms } = shader;
    const time = this.orbTime;
    const flow = time * IDLE_FLOW;
    gl.useProgram(handle);
    gl.uniform2f(uniforms.uRes ?? null, ATLAS_SIZE, ATLAS_SIZE);
    gl.uniform1f(uniforms.uTime ?? null, time * 0.5);
    gl.uniform1f(uniforms.uAnim ?? null, flow);
    gl.uniform1f(uniforms.uInput ?? null, 0);
    gl.uniform1f(uniforms.uOutput ?? null, IDLE_OUTPUT);
    for (const [key, value, origin] of params) {
      gl.uniform1f(uniforms[key] ?? null, origin === null ? value : origin + flow * value);
    }
    for (const [key, value] of colors) gl.uniform3fv(uniforms[key] ?? null, value);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawPlanet(type) {
    const gl = this.gl;
    const { handle, uniforms } = this.orbProgram(type);
    gl.useProgram(handle);
    const daylight = 1 - this.night;
    const values = {
      uTime: this.orbTime * 0.35, uRotationOffset: type.phase,
      uSunDirection: [0.48, 0.42, 0.77],
      uSunIntensity: 2 + daylight * 0.6, uAmbientLight: 0.12 + daylight * 0.48,
      uBumpStrength: 0.01,
      ...type.uniforms,
    };
    // The Earth atmosphere otherwise creates a neon-blue rim over white glass.
    if (type.field === "earth") values.uAtmosphereDensity *= this.night;
    for (const [key, value] of Object.entries(values)) {
      const location = uniforms[key];
      if (location === undefined) continue;
      if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2fv(location, value);
        else gl.uniform3fv(location, value);
      } else gl.uniform1f(location, value);
    }
    let unit = 3;
    for (const [name, key] of Object.entries(texturesFor(type))) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.planetTextures.get(key));
      gl.uniform1i(uniforms[name], unit++);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  copyOrbPreview(canvas, type) {
    const gl = this.gl;
    if (!this.preview) {
      this.preview = target(gl);
      sizeTarget(gl, this.preview, ATLAS_SIZE, ATLAS_SIZE);
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.preview.framebuffer);
    gl.viewport(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawOrb(makePreset(type));
    const pixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
    gl.readPixels(0, 0, ATLAS_SIZE, ATLAS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    canvas.width = ATLAS_SIZE;
    canvas.height = ATLAS_SIZE;
    const context = canvas.getContext("2d");
    const image = context.createImageData(ATLAS_SIZE, ATLAS_SIZE);
    for (let row = 0; row < ATLAS_SIZE; row++) {
      const source = (ATLAS_SIZE - row - 1) * ATLAS_SIZE * 4;
      image.data.set(pixels.subarray(source, source + ATLAS_SIZE * 4), row * ATLAS_SIZE * 4);
    }
    // The atlas uses premultiplied alpha; ImageData expects straight alpha.
    for (let pixel = 0; pixel < image.data.length; pixel += 4) {
      const alpha = image.data[pixel + 3];
      if (alpha === 0) continue;
      for (let channel = 0; channel < 3; channel++) {
        image.data[pixel + channel] = Math.min(255, image.data[pixel + channel] * 255 / alpha);
      }
    }
    context.putImageData(image, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  uploadTiles(tiles) {
    const gl = this.gl;
    let offset = 0;
    for (const tile of tiles) {
      this.instanceData.set([
        tile.x, tile.y, tile.half, tile.opacity,
        tile.strainX, tile.strainY, tile.tugX, tile.tugY,
        tile.orbX, tile.orbY, tile.orbRadius, tile.type,
        tile.phase, tile.lift, tile.focus, 0,
      ], offset);
      offset += TILE_STRIDE;
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    if (offset > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, offset);
  }

  mergeUniforms({ points, half, radius, type, progress }) {
    const reduced = this.reducedMotion;
    const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const shellJoin = reduced ? 1 : smooth(0.025, 0.47, progress);
    const orbJoin = smooth(0.08, 0.40, progress);
    const shrink = reduced ? 0 : smooth(0.82, 1, progress);
    const fadeStart = 0.90;
    const fadeEnd = 1;
    const opacity = 1 - smooth(reduced ? 0.05 : fadeStart, fadeEnd, progress);
    const size = half * (1 + 0.052 * Math.sin(shellJoin * Math.PI)) * (1 - shrink * 0.86);
    const coreSize = radius * (1 + 0.115 * orbJoin) * (1 - shrink * 0.88);
    const contraction = 1 - shrink * 0.96;
    const coordinates = new Float32Array(points.length * 4);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    points.forEach((point, index) => {
      const x = centerX + (point.x - centerX) * contraction;
      const y = centerY + (point.y - centerY) * contraction;
      coordinates.set([x, y, point.right, point.down], index * 4);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });
    const padding = size * 1.74 + 4;
    return {
      coordinates, count: points.length, centerX, centerY, spacing: half / 0.459 * contraction,
      bounds: [minX - padding, minY - padding, maxX + padding, maxY + padding],
      shape: [size, opacity, type, shellJoin],
      inner: [coreSize, orbJoin],
    };
  }

  draw({ handle, uniforms }, count, merges, time, night) {
    const gl = this.gl;
    gl.useProgram(handle);
    gl.uniform2f(uniforms.uViewport, this.width, this.height);
    gl.uniform1f(uniforms.uTime ?? null, time);
    gl.uniform1f(uniforms.uNight, night);
    gl.uniform1fv(uniforms.uExtents ?? null, this.extents);
    gl.uniform1i(uniforms.uCollision ?? null, true);
    gl.uniform1i(uniforms.uCollisionTexture ?? null, 3);
    gl.uniform1i(uniforms.uMergeCount, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    for (const merge of merges) {
      gl.uniform1i(uniforms.uMergeCount, merge.count);
      gl.uniform4fv(uniforms.uParts, merge.coordinates);
      gl.uniform2f(uniforms.uCentroid ?? null, merge.centerX, merge.centerY);
      gl.uniform1f(uniforms.uSpacing, merge.spacing);
      gl.uniform4fv(uniforms.uBounds, merge.bounds);
      gl.uniform4fv(uniforms.uMerge, merge.shape);
      gl.uniform2fv(uniforms.uInner ?? null, merge.inner);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
    }
  }
}
