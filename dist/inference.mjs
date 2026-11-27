export function classify(pixels, model, weights) {
  const tensor = (h, w, c) => ({h, w, c, data: new Float32Array(h*w*c)});
  const values = new Map();
  const input = tensor(224, 224, 3);
  input.data.set(pixels);
  values.set(model.input, input);
  const uses = new Map();
  for (const [, , args] of model.ops) {
    for (const key of args) uses.set(key, (uses.get(key) || 0) + 1);
  }
  let output;
  for (const [kind, name, args, config, parameters] of model.ops) {
    const [a,b] = args.map(key => values.get(key));
    const {h,w,c,data} = a;
    const p = parameters.map(([start, shape]) =>
      weights.subarray(start, start + shape.reduce((x,y) => x*y, 1)));
    switch (kind) {
      case "Conv2D":
      case "DepthwiseConv2D": {
        const depthwise = kind === "DepthwiseConv2D";
        const [kh,kw,,filters] = parameters[0][1];
        const [sy,sx] = config.strides;
        const same = config.padding === "same";
        const oh = same ? Math.ceil(h/sy) : Math.floor((h-kh)/sy)+1;
        const ow = same ? Math.ceil(w/sx) : Math.floor((w-kw)/sx)+1;
        const top = same ? Math.floor(Math.max(0,(oh-1)*sy+kh-h)/2) : 0;
        const left = same ? Math.floor(Math.max(0,(ow-1)*sx+kw-w)/2) : 0;
        const oc = depthwise ? c : filters;
        output = tensor(oh,ow,oc);
        const dest = output.data, kernel = p[0], bias = p[1];
        const sums = new Float64Array(oc);
        for (let y=0; y<oh; y++) for (let x=0; x<ow; x++) {
          if (bias) sums.set(bias);
          else sums.fill(0);
          for (let ky=0; ky<kh; ky++) {
            const iy = y*sy+ky-top;
            if (iy<0 || iy>=h) continue;
            for (let kx=0; kx<kw; kx++) {
              const ix = x*sx+kx-left;
              if (ix<0 || ix>=w) continue;
              const src = (iy*w+ix)*c;
              const k = (ky*kw+kx)*c;
              if (depthwise) {
                for (let i=0; i<c; i++) sums[i] += data[src+i]*kernel[k+i];
              } else {
                for (let i=0; i<c; i++) {
                  const v = data[src+i], row = (k+i)*oc;
                  for (let j=0; j<oc; j++) sums[j] += v*kernel[row+j];
                }
              }
            }
          }
          dest.set(sums,(y*ow+x)*oc);
        }
        break;
      }
      case "ZeroPadding2D": {
        const [[top,bottom],[left,right]] = config.padding;
        output = tensor(h+top+bottom,w+left+right,c);
        for (let y=0; y<h; y++) {
          output.data.set(data.subarray(y*w*c,(y+1)*w*c),((y+top)*output.w+left)*c);
        }
        break;
      }
      case "GlobalAveragePooling2D": {
        output = tensor(1,1,c);
        const sums = new Float64Array(c);
        for (let i=0; i<data.length; i+=c) for (let j=0; j<c; j++) sums[j] += data[i+j];
        for (let j=0; j<c; j++) output.data[j] = sums[j]/(h*w);
        break;
      }
      case "Dense": {
        output = tensor(1,1,p[1].length);
        const logits = Array.from(p[1], (bias,j) => {
          let v = bias;
          for (let i=0; i<c; i++) v += data[i]*p[0][i*p[1].length+j];
          return v;
        });
        const max = Math.max(...logits), exp = logits.map(v => Math.exp(v-max));
        const total = exp.reduce((sum,v) => sum+v,0);
        output.data.set(exp.map(v => v/total));
        break;
      }
      default: {
        output = tensor(h,w,c);
        const dest = output.data;
        switch (kind) {
          case "Rescaling":
            for (let i=0; i<data.length; i++) dest[i] = data[i]*config.scale+config.offset;
            break;
          case "BatchNormalization": {
            const [gamma,beta,mean,variance] = p;
            const scale = gamma.map((v,j) => v / Math.sqrt(variance[j]+config.epsilon));
            for (let i=0; i<data.length; i++) {
              const j = i%c;
              dest[i] = (data[i]-mean[j])*scale[j]+beta[j];
            }
            break;
          }
          case "ReLU":
            for (let i=0; i<data.length; i++) dest[i] = Math.min(config.max_value ?? Infinity, Math.max(0,data[i]));
            break;
          case "Activation":
            for (let i=0; i<data.length; i++) dest[i] = data[i]*Math.max(0,Math.min(6,data[i]+3))/6;
            break;
          case "Multiply":
            for (let i=0; i<data.length; i++) dest[i] = data[i] * (b ? b.data[i%b.data.length] : config.offset);
            break;
          case "Add":
            for (let i=0; i<data.length; i++) dest[i] = data[i] + (b ? b.data[i] : config.offset);
            break;
          default: throw new Error("Unsupported layer: "+kind);
        }
      }
    }
    values.set(name, output);
    for (const key of args) {
      uses.set(key, uses.get(key)-1);
      if (!uses.get(key)) values.delete(key);
    }
  }
  return output.data;
}
