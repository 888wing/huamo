import source from './smoke-procedural.wgsl';

const readNumber = (query, name, fallback, min, max) => {
  const raw = query.get(name)?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

export function readSmokeOptions(query) {
  return {
    seed: Math.floor(readNumber(query, 'smokeSeed', 0, 0, 0xffffffff)),
    turbulence: readNumber(query, 'smokeTurbulence', 1, .45, 1.65),
    scale: readNumber(query, 'smokeScale', 1, .65, 1.2),
    wisps: readNumber(query, 'smokeWisps', 1, 0, 2),
  };
}

// The compositor reads one of four independent grayscale variants from RGBA in each atlas cell.
export async function createProceduralSmokeAtlas(gpu, noise, { seed = 0, turbulence = 1, scale = 1, wisps = 1 } = {}) {
  const tile = 384;
  const atlas = gpu.tex([tile * 4, tile * 3], 'rgba8unorm',
    GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC);
  const repeat = gpu.device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat',
  });
  const module = await gpu.module(source, 'procedural smoke');
  const pipeline = await gpu.device.createComputePipelineAsync({
    label: 'bakeSmoke',
    layout: 'auto',
    compute: {
      module,
      entryPoint: 'bakeSmoke',
      constants: { smokeSeed: seed, smokeTurbulence: turbulence, smokeScale: scale, smokeWisps: wisps },
    },
  });
  const frame = gpu.begin();
  frame.stage('bake smoke');
  frame.run(pipeline, { 0: noise, 1: repeat, 2: atlas }, atlas.width / 8, atlas.height / 8);
  frame.end();
  return atlas;
}
