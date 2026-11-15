// Thin raw-WebGPU layer for the simulations. No three.js in here: the sims own the device and three is a guest on it.

export async function createDevice() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('This page needs WebGPU (desktop Chrome or Edge).');
  // three checks for 'core-features-and-limits', and the sims use float32-filterable and timestamp-query when present
  const device = await adapter.requestDevice({ requiredFeatures: [...adapter.features] });
  device.addEventListener('uncapturederror', e => console.error('GPU: ' + e.error.message));
  return { adapter, device };
}

let ids = 0;
const idOf = o => (o.__id ??= ++ids);

export class Gpu {
  constructor(device) {
    this.device = device;
    this.groups = new Map();
    this.canTime = device.features.has('timestamp-query');
    this.linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    if (this.canTime) {
      this.qCap = 32;
      this.qSet = device.createQuerySet({ type: 'timestamp', count: this.qCap });
      this.qBuf = device.createBuffer({ size: this.qCap * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.qRead = device.createBuffer({ size: this.qCap * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    }
  }

  tex(size, format, usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST) {
    const t = this.device.createTexture({ size, format, usage, dimension: size.length === 3 ? '3d' : '2d' });
    t.view = t.createView();
    return t;
  }

  async module(code, label) {
    const m = this.device.createShaderModule({ code, label });
    const info = await m.getCompilationInfo();
    for (const msg of info.messages) if (msg.type === 'error') console.error(`WGSL ${label}:${msg.lineNum}:${msg.linePos} ${msg.message}`);
    return m;
  }

  pipeline(module, entryPoint) {
    return this.device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint }, label: entryPoint });
  }

  // bind: { bindingIndex: GPUTexture | GPUBuffer | GPUSampler }. Bind groups are cached per (pipeline, resources).
  group(pipe, bind) {
    let key = idOf(pipe) + ':';
    for (const k in bind) key += k + '=' + idOf(bind[k]) + ',';
    let g = this.groups.get(key);
    if (!g) {
      const entries = Object.entries(bind).map(([k, r]) => ({
        binding: +k,
        resource: r instanceof GPUTexture ? r.view : r instanceof GPUBuffer ? { buffer: r } : r,
      }));
      g = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
      this.groups.set(key, g);
    }
    return g;
  }

  // One frame of compute work. stage(name) opens a compute pass; with timing on, each stage gets a timestamp pair.
  begin(timed = false) {
    const enc = this.device.createCommandEncoder();
    const gpu = this, names = [];
    let pass = null;
    const useT = timed && this.canTime && !this.qBusy;
    return {
      enc,
      stage(name) {
        pass?.end();
        const i = names.length;
        const desc = useT && i * 2 + 1 < gpu.qCap ? { timestampWrites: { querySet: gpu.qSet, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 } } : {};
        names.push(name);
        pass = enc.beginComputePass(desc);
      },
      run(pipe, bind, x, y = 1, z = 1) {
        pass.setPipeline(pipe);
        pass.setBindGroup(0, gpu.group(pipe, bind));
        pass.dispatchWorkgroups(x, y, z);
      },
      copy(src, dst) {
        pass?.end(); pass = null;
        enc.copyTextureToTexture({ texture: src }, { texture: dst }, [src.width, src.height, src.depthOrArrayLayers]);
      },
      // resolves to { stageName: ms } when timed, else null
      end() {
        pass?.end();
        if (!useT) { gpu.device.queue.submit([enc.finish()]); return null; }
        const n = Math.min(names.length * 2, gpu.qCap);
        enc.resolveQuerySet(gpu.qSet, 0, n, gpu.qBuf, 0);
        enc.copyBufferToBuffer(gpu.qBuf, 0, gpu.qRead, 0, n * 8);
        gpu.device.queue.submit([enc.finish()]);
        gpu.qBusy = true;
        return gpu.qRead.mapAsync(GPUMapMode.READ, 0, n * 8).then(() => {
          const t = new BigInt64Array(gpu.qRead.getMappedRange(0, n * 8).slice(0));
          gpu.qRead.unmap(); gpu.qBusy = false;
          const out = {};
          names.forEach((nm, i) => { if (i * 2 + 1 < n) out[nm] = (out[nm] ?? 0) + Number(t[i * 2 + 1] - t[i * 2]) / 1e6; });
          return out;
        });
      },
    };
  }

  // Reads a whole texture back. Returns Float32Array (r32float / rgba32float) or Uint16Array (rgba16float).
  async read(t) {
    const comps = t.format.startsWith('rgba') ? 4 : 1, bytes = t.format.includes('16') ? 2 : 4;
    const [w, h, d] = [t.width, t.height, t.depthOrArrayLayers];
    const bpr = Math.ceil(w * comps * bytes / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr * h * d, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, [w, h, d]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const raw = buf.getMappedRange();
    const Arr = bytes === 2 ? Uint16Array : t.format.endsWith('uint') ? Uint32Array : Float32Array;
    const out = new Arr(w * h * d * comps), rowLen = w * comps;
    for (let r = 0; r < h * d; r++) out.set(new Arr(raw, r * bpr, rowLen), r * rowLen);
    buf.unmap(); buf.destroy();
    return out;
  }
}

// half float -> number, for reading rgba16float textures back
export function half(h) {
  const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1;
  return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
}
