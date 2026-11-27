import { classify } from "./inference.mjs";

const assets = Promise.all([fetch("./model.json"),fetch("./weights.bin")]).then(([model,weights]) => {
  if (!model.ok || !weights.ok) throw new Error("Scanner data unavailable");
  return Promise.all([model.json(),weights.arrayBuffer()]);
});
assets.catch(() => {});

self.onmessage = async ({data: {id,pixels}}) => {
  try {
    const [model, weights] = await assets;
    const scores = classify(pixels, model, new Float32Array(weights));
    const score = Math.max(...scores);
    self.postMessage({id, category:model.labels[scores.indexOf(score)], score});
  } catch {
    self.postMessage({id, error:"Scanner could not load. Reload the page and try again."});
  }
};
